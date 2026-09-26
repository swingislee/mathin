import { newId } from "@/lib/uuid";
import { spatialActionProgress } from "../spatial-interaction/policy";
import {
  boardTotal, boardUnits, PLACE_VALUE_HISTORY_LIMIT, PLACE_VALUE_LIMIT, placeValueBoardSchema,
  type PlaceValueAction, type PlaceValueBoard, type PlaceValueChange, type PlaceValueInitial,
  type PlaceValueMotion, type PlaceValuePlace, type PlaceValueSide, type PlaceValueSnapshot,
} from "./contract";

export interface PlaceValueCube { id: number; x: number; y: number; z: number; place: PlaceValuePlace; opacity?: number }
export interface PlaceValueRotation { ids: number[]; pivot: { x: number; y: number; z: number }; axis: "x" | "y"; angle: number; local: PlaceValueCube[] }
export const PLACE_VALUE_COLUMNS = { hundreds: -5, tens: 0, ones: 5 } as const;
export const PLACE_VALUE_PLACES = ["hundreds", "tens", "ones"] as const;
export const PLACE_VALUE_WEIGHTS = { hundreds: 100, tens: 10, ones: 1 } as const;
/** 镜头以数位前沿的中间为锚点；百链加长也不改变旋转支点。 */
export const PLACE_VALUE_CAMERA_TARGET = { x: 0, y: 4, z: 0 } as const;
export const placeValueOffset = (mode: PlaceValueInitial["mode"], side: PlaceValueSide) => mode === "compare" ? side === "left" ? -9 : 9 : 0;
/** 第六至第十组反向摆放，用原来的另一端朝前；成员顺序和颜色不变。 */
function laidOutRod(ids: number[], index: number, place: "tens" | "hundreds"): PlaceValueCube[] {
  return ids.map((id, member) => {
    const depth = index % 10 < 5 ? member : ids.length - 1 - member;
    return { id, x: PLACE_VALUE_COLUMNS[place], y: index + .5, z: depth === 0 ? 0 : -depth, place };
  });
}
export function placeValueLayout(board: PlaceValueBoard): PlaceValueCube[] {
  return [
    ...board.hundreds.flatMap((hundred, index) => laidOutRod(hundred.flat(), index, "hundreds")),
    ...board.tens.flatMap((ten, index) => laidOutRod(ten, index, "tens")),
    ...board.ones.map((id, index) => ({ id, x: 5, y: index + .5, z: 0, place: "ones" as const })),
  ];
}
export function placeValueGroup(board: PlaceValueBoard, unit: number) {
  const hundred = board.hundreds.findIndex((group) => group.flat().includes(unit));
  if (hundred >= 0) return { place: "hundreds" as const, index: hundred, ids: board.hundreds[hundred].flat() };
  const ten = board.tens.findIndex((group) => group.includes(unit));
  if (ten >= 0) return { place: "tens" as const, index: ten, ids: board.tens[ten] };
  const one = board.ones.indexOf(unit);
  return one < 0 ? null : { place: "ones" as const, index: one, ids: [unit] };
}
export function placeValueCarry(board: PlaceValueBoard): PlaceValueAction | null {
  return board.ones.length >= 10 ? "carry-one" : board.tens.length >= 10 ? "carry-ten" : null;
}
export function changePlaceValueBoard(board: PlaceValueBoard, action: PlaceValueAction, selectedUnit?: number): PlaceValueBoard | null {
  const next = structuredClone(board);
  if (action === "add") {
    if (boardTotal(board) >= PLACE_VALUE_LIMIT || board.nextId >= 1_000_000) return null;
    next.ones.push(next.nextId++ * 2 + (next.ones.length % 10 < 5 ? 0 : 1));
  } else if (action === "remove") { if (!next.ones.length) return null; next.ones.pop(); }
  else if (action === "carry-one") { if (next.ones.length < 10) return null; next.tens.push(next.ones.splice(-10)); }
  else if (action === "carry-ten") { if (next.tens.length < 10) return null; next.hundreds.push(next.tens.splice(-10)); }
  else if (action === "unpack-ten") {
    if (!next.tens.length) return null;
    const selected = next.tens.findIndex((group) => selectedUnit !== undefined && group.includes(selectedUnit));
    next.ones.push(...next.tens.splice(selected < 0 ? next.tens.length - 1 : selected, 1)[0]);
  } else if (action === "unpack-hundred") {
    if (!next.hundreds.length) return null;
    const selected = next.hundreds.findIndex((group) => selectedUnit !== undefined && group.flat().includes(selectedUnit));
    next.tens.push(...next.hundreds.splice(selected < 0 ? next.hundreds.length - 1 : selected, 1)[0]);
  } else return null;
  return placeValueBoardSchema.parse(next);
}
export function placeValueProgress(motion: PlaceValueMotion | null, now: number): number {
  return !motion ? 1 : motion.paused ? motion.progress : Math.min(1, motion.progress + Math.max(0, now - motion.startedAt) / motion.durationMs);
}
export function placeValueBusy(snapshot: PlaceValueSnapshot, now = Date.now()) { return placeValueProgress(snapshot.motion, now) < 1; }
export function isPlaceValueRegrouping(kind?: PlaceValueAction) { return !!kind && (kind.startsWith("carry-") || kind.startsWith("unpack-")); }
export function placeValueLocked(snapshot: PlaceValueSnapshot, now = Date.now()) { return isPlaceValueRegrouping(snapshot.motion?.kind) && placeValueBusy(snapshot, now); }
export function placeValueDuration(kind: PlaceValueAction, speed: PlaceValueInitial["speed"]) {
  return (kind === "carry-ten" || kind === "unpack-hundred" ? 7200 : isPlaceValueRegrouping(kind) ? 2200 : 180) * ({ slow: 1.5, normal: 1, fast: .6 }[speed]);
}
export function applyPlaceValueChange(snapshot: PlaceValueSnapshot, change: PlaceValueChange, now = Date.now(), paused = false): PlaceValueSnapshot {
  const selection = snapshot.selection?.side === change.side && !boardUnits(change.after).includes(snapshot.selection.unit) ? null : snapshot.selection;
  return { ...snapshot, [change.side]: change.after, selection,
    motion: { ...change, id: newId(), startedAt: now, durationMs: placeValueDuration(change.kind, snapshot.speed), progress: 0, paused },
    past: [...snapshot.past, change].slice(-PLACE_VALUE_HISTORY_LIMIT), future: [] };
}
export function planPlaceValue(snapshot: PlaceValueSnapshot, action: PlaceValueAction, now = Date.now(), paused = false): PlaceValueSnapshot | null {
  if (placeValueLocked(snapshot, now)) return null;
  const side = snapshot.mode === "single" ? "left" : snapshot.active;
  const next = changePlaceValueBoard(snapshot[side], action, snapshot.selection?.side === side ? snapshot.selection.unit : undefined);
  return next ? applyPlaceValueChange(snapshot, { side, before: snapshot[side], after: next, kind: action }, now, paused) : null;
}
/** 数位下的加减/输入只改变该数位的单位数，其他列的成员身份保持不变。 */
export function planPlaceValueCount(snapshot: PlaceValueSnapshot, side: PlaceValueSide, place: PlaceValuePlace, count: number, now = Date.now()): PlaceValueSnapshot | null {
  if (placeValueLocked(snapshot, now) || !Number.isInteger(count) || count < 0) return null;
  const before = snapshot[side], current = before[place].length, weight = PLACE_VALUE_WEIGHTS[place];
  if (count === current || boardTotal(before) + (count - current) * weight > PLACE_VALUE_LIMIT) return null;
  if (place === "ones" && Math.abs(count - current) === 1) return planPlaceValue({ ...snapshot, active: side }, count > current ? "add" : "remove", now);
  const after = structuredClone(before);
  if (count < current) after[place].splice(count);
  else {
    if (after.nextId + (count - current) * weight > 1_000_000) return null;
    for (let index = current; index < count; index++) {
      const units = Array.from({ length: weight }, (_, depth) => after.nextId++ * 2 + ((place === "ones" ? index : depth) % 10 < 5 ? 0 : 1));
      if (place === "ones") after.ones.push(units[0]);
      else if (place === "tens") after.tens.push(units);
      else after.hundreds.push(Array.from({ length: 10 }, (_, ten) => units.slice(ten * 10, ten * 10 + 10)));
    }
  }
  return applyPlaceValueChange({ ...snapshot, active: side }, { side, kind: "replace", before, after: placeValueBoardSchema.parse(after) }, now);
}

export function placeValueNumeral(count: number) {
  return { digit: Math.min(9, count), extra: Math.max(0, count - 9) };
}
/** 数字与几何读取同一个进度；尚未归组显示 9/+1，而非抢先显示高一位的 1。 */
export function placeValueNotation(snapshot: PlaceValueSnapshot, side: PlaceValueSide, place: PlaceValuePlace, progress: number) {
  const motion = snapshot.motion?.side === side ? snapshot.motion : null;
  const after = placeValueNumeral(snapshot[side][place].length);
  const before = motion && isPlaceValueRegrouping(motion.kind) ? placeValueNumeral(motion.before[place].length) : after;
  const changing = before.digit !== after.digit || before.extra !== after.extra;
  return { before, after, blend: changing ? spatialActionProgress(progress) : 1 };
}
export function pausePlaceValue(snapshot: PlaceValueSnapshot, now = Date.now()): PlaceValueSnapshot {
  if (!snapshot.motion) return snapshot;
  return { ...snapshot, motion: { ...snapshot.motion, progress: placeValueProgress(snapshot.motion, now), paused: true } };
}
export function resumePlaceValue(snapshot: PlaceValueSnapshot, now = Date.now()): PlaceValueSnapshot {
  if (!snapshot.motion) return snapshot;
  return { ...snapshot, motion: { ...snapshot.motion, startedAt: now, paused: false } };
}
const reverseKind: Record<PlaceValueAction, PlaceValueAction> = { add: "remove", remove: "add", "carry-one": "unpack-ten", "carry-ten": "unpack-hundred", "unpack-ten": "carry-one", "unpack-hundred": "carry-ten", replace: "replace" };
export function historyPlaceValue(snapshot: PlaceValueSnapshot, direction: "undo" | "redo", now = Date.now()): PlaceValueSnapshot | null {
  if (placeValueLocked(snapshot, now)) return null;
  const entry = (direction === "undo" ? snapshot.past : snapshot.future).at(-1); if (!entry) return null;
  // 增删的反向回放允许恢复原序号，使用 replace 保护严格的新增分配合同。
  const kind = entry.kind === "add" || entry.kind === "remove" ? "replace" : reverseKind[entry.kind];
  const change = direction === "undo" ? { ...entry, before: entry.after, after: entry.before, kind } : entry;
  const next = applyPlaceValueChange(snapshot, change, now);
  return { ...next, past: direction === "undo" ? snapshot.past.slice(0, -1) : [...snapshot.past, entry].slice(-PLACE_VALUE_HISTORY_LIMIT),
    future: direction === "undo" ? [...snapshot.future, entry].slice(-PLACE_VALUE_HISTORY_LIMIT) : snapshot.future.slice(0, -1) };
}
/** 几何只读取成员身份；躺倒、掉头与首尾连接都保持每条积木刚性。 */
export function placeValuePose(change: PlaceValueChange, progress: number): { cubes: PlaceValueCube[]; rotations: PlaceValueRotation[] } {
  if (change.kind === "unpack-ten" || change.kind === "unpack-hundred") return placeValuePose({ ...change, before: change.after, after: change.before, kind: reverseKind[change.kind] }, 1 - progress);
  const from = placeValueLayout(change.before), to = placeValueLayout(change.after);
  if (progress <= 0) return { cubes: from, rotations: [] };
  if (progress >= 1) return { cubes: to, rotations: [] };
  const start = new Map(from.map((p) => [p.id, p])), end = new Map(to.map((p) => [p.id, p]));
  const ids = new Set([...start.keys(), ...end.keys()]), t = spatialActionProgress(progress);
  const cubes: PlaceValueCube[] = [], rotations: PlaceValueRotation[] = [], handled = new Set<number>();
  const midpoint = (points: Map<number, PlaceValueCube>, members: number[]) => {
    const first = points.get(members[0])!, last = points.get(members.at(-1)!)!;
    return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, z: (first.z + last.z) / 2 };
  };
  const moveRod = (members: number[], local: number, lift = 0, standToLie = false) => {
    members.forEach((id) => handled.add(id));
    const a = midpoint(start, members), b = midpoint(end, members);
    const direction = (points: Map<number, PlaceValueCube>) => Math.sign(points.get(members.at(-1)!)!.z - points.get(members[0])!.z);
    const angle = standToLie ? direction(end) * Math.PI / 2 : direction(start) !== direction(end) ? Math.PI : 0;
    if (angle && local > 0 && local < 1) {
      rotations.push({ ids: members, axis: standToLie ? "x" : "y", angle: angle * local,
        pivot: { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local + lift * Math.sin(Math.PI * local), z: a.z + (b.z - a.z) * local },
        local: members.map((id) => { const p = start.get(id)!; return { ...end.get(id)!, x: p.x - a.x, y: p.y - a.y, z: p.z - a.z }; }) });
    } else {
      members.forEach((id) => { const p = start.get(id)!, q = end.get(id)!;
        cubes.push({ ...q, x: p.x + (q.x - p.x) * local, y: p.y + (q.y - p.y) * local + lift * Math.sin(Math.PI * local), z: p.z + (q.z - p.z) * local });
      });
    }
  };
  let tenIds: number[] = [], hundredIds: number[] = [];
  if (change.kind === "carry-one") tenIds = change.after.tens.find((group) => !change.before.tens.some((old) => old[0] === group[0])) ?? [];
  if (change.kind === "carry-ten") hundredIds = change.after.hundreds.find((group) => !change.before.hundreds.some((old) => old[0][0] === group[0][0]))?.flat() ?? [];
  if (tenIds.length) moveRod(tenIds, t, 1.5, true);
  for (let index = 0; index < hundredIds.length / 10; index++) {
    const local = spatialActionProgress(Math.max(0, Math.min(1, progress * 10 - (9 - index))));
    moveRod(hundredIds.slice(index * 10, index * 10 + 10), local, 2);
  }
  // 拆开中间一组后，上方组的顺位可能跨过第五组；整条转向，避免逐块插值时挤在一起。
  for (const place of ["tens", "hundreds"] as const) for (const group of change.after[place]) {
    const members = group.flat();
    if (members.every((id) => !handled.has(id) && start.get(id)?.place === place)) moveRod(members, t);
  }
  for (const id of ids) {
    if (handled.has(id)) continue;
    const a = start.get(id), b = end.get(id);
    if (!a && b) { cubes.push({ ...b, y: b.y + (1 - t) * 2, opacity: progress === 0 ? .01 : Math.max(.1, t) }); continue; }
    if (!b && a) { if (progress < 1) cubes.push({ ...a, y: a.y + t * 2, opacity: Math.max(.01, 1 - t) }); continue; }
    if (!a || !b) continue;
    cubes.push({ ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  }
  return { cubes, rotations };
}
export function placeValueFrame(snapshot: Pick<PlaceValueInitial, "left" | "right" | "mode" | "view">): PlaceValueInitial["frame"] {
  const sides: PlaceValueSide[] = snapshot.mode === "compare" ? ["left", "right"] : ["left"];
  const points = sides.flatMap((side) => placeValueLayout(snapshot[side]).map((p) => ({ ...p, x: p.x + (snapshot.mode === "compare" ? side === "left" ? -9 : 9 : 0) })));
  const x = Math.max(snapshot.mode === "compare" ? 15 : 6, ...points.map((p) => Math.abs(p.x) + 1));
  const y = Math.max(8, ...points.map((p) => Math.abs(p.y - PLACE_VALUE_CAMERA_TARGET.y) + 2));
  const z = Math.max(3, ...points.map((p) => Math.abs(p.z) + 2));
  const radius = snapshot.view === "front" ? Math.max(x * .78, y) : snapshot.view === "left" || snapshot.view === "right" ? Math.max(z * .78, y) : Math.hypot(x, y, z);
  return { center: { ...PLACE_VALUE_CAMERA_TARGET }, radius: Math.max(8.5, radius) };
}
