import { newId } from "@/lib/uuid";
import { spatialActionProgress } from "../spatial-interaction/policy";
import {
  boardTotal, boardUnits, PLACE_VALUE_HISTORY_LIMIT, PLACE_VALUE_LIMIT, placeValueBoardSchema,
  type PlaceValueAction, type PlaceValueBoard, type PlaceValueChange, type PlaceValueInitial,
  type PlaceValueMotion, type PlaceValuePlace, type PlaceValueSide, type PlaceValueSnapshot,
} from "./contract";

export interface PlaceValueCube { id: number; x: number; y: number; z: number; place: PlaceValuePlace; opacity?: number }
export interface PlaceValueRotation { ids: number[]; pivot: { x: number; y: number; z: number }; angle: number; local: PlaceValueCube[] }
export const PLACE_VALUE_COLUMNS = { hundreds: -5, tens: 0, ones: 5 } as const;
export function placeValueLayout(board: PlaceValueBoard): PlaceValueCube[] {
  return [
    ...board.hundreds.flatMap((hundred, index) => hundred.flat().map((id, depth) => ({ id, x: -5, y: index + .5, z: depth === 0 ? 0 : -depth, place: "hundreds" as const }))),
    ...board.tens.flatMap((ten, index) => ten.map((id, depth) => ({ id, x: 0, y: index + .5, z: depth === 0 ? 0 : -depth, place: "tens" as const }))),
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
export function placeValueDuration(kind: PlaceValueAction, speed: PlaceValueInitial["speed"]) {
  return (kind === "carry-ten" || kind === "unpack-hundred" ? 7200 : kind === "add" || kind === "remove" ? 600 : 2200) * ({ slow: 1.5, normal: 1, fast: .6 }[speed]);
}
export function applyPlaceValueChange(snapshot: PlaceValueSnapshot, change: PlaceValueChange, now = Date.now(), paused = false): PlaceValueSnapshot {
  const selection = snapshot.selection?.side === change.side && !boardUnits(change.after).includes(snapshot.selection.unit) ? null : snapshot.selection;
  return { ...snapshot, [change.side]: change.after, selection,
    motion: { ...change, id: newId(), startedAt: now, durationMs: placeValueDuration(change.kind, snapshot.speed), progress: 0, paused },
    past: [...snapshot.past, change].slice(-PLACE_VALUE_HISTORY_LIMIT), future: [] };
}
export function planPlaceValue(snapshot: PlaceValueSnapshot, action: PlaceValueAction, now = Date.now(), paused = false): PlaceValueSnapshot | null {
  if (placeValueBusy(snapshot, now)) return null;
  const side = snapshot.mode === "single" ? "left" : snapshot.active;
  const next = changePlaceValueBoard(snapshot[side], action, snapshot.selection?.side === side ? snapshot.selection.unit : undefined);
  return next ? applyPlaceValueChange(snapshot, { side, before: snapshot[side], after: next, kind: action }, now, paused) : null;
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
  if (placeValueBusy(snapshot, now)) return null;
  const entry = (direction === "undo" ? snapshot.past : snapshot.future).at(-1); if (!entry) return null;
  // 增删的反向回放允许恢复原序号，使用 replace 保护严格的新增分配合同。
  const kind = entry.kind === "add" || entry.kind === "remove" ? "replace" : reverseKind[entry.kind];
  const change = direction === "undo" ? { ...entry, before: entry.after, after: entry.before, kind } : entry;
  const next = applyPlaceValueChange(snapshot, change, now);
  return { ...next, past: direction === "undo" ? snapshot.past.slice(0, -1) : [...snapshot.past, entry].slice(-PLACE_VALUE_HISTORY_LIMIT),
    future: direction === "undo" ? [...snapshot.future, entry].slice(-PLACE_VALUE_HISTORY_LIMIT) : snapshot.future.slice(0, -1) };
}
/** 几何只读取成员身份；十条连接时每条自身保持刚性。 */
export function placeValuePose(change: PlaceValueChange, progress: number): { cubes: PlaceValueCube[]; rotation: PlaceValueRotation | null } {
  if (change.kind === "unpack-ten" || change.kind === "unpack-hundred") return placeValuePose({ ...change, before: change.after, after: change.before, kind: reverseKind[change.kind] }, 1 - progress);
  const from = placeValueLayout(change.before), to = placeValueLayout(change.after);
  if (progress <= 0) return { cubes: from, rotation: null };
  if (progress >= 1) return { cubes: to, rotation: null };
  const start = new Map(from.map((p) => [p.id, p])), end = new Map(to.map((p) => [p.id, p]));
  const ids = new Set([...start.keys(), ...end.keys()]), t = spatialActionProgress(progress);
  let rotation: PlaceValueRotation | null = null;
  let tenIds: number[] = [], hundredIds: number[] = [];
  if (change.kind === "carry-one") tenIds = change.after.tens.find((group) => !change.before.tens.some((old) => old[0] === group[0])) ?? [];
  if (change.kind === "carry-ten") hundredIds = change.after.hundreds.find((group) => !change.before.hundreds.some((old) => old[0][0] === group[0][0]))?.flat() ?? [];
  if (tenIds.length && progress > 0 && progress < 1) {
    const a = start.get(tenIds[0])!, b = end.get(tenIds[0])!, angle = -Math.PI / 2 * t;
    rotation = { ids: tenIds, angle, pivot: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + 1.5 * Math.sin(Math.PI * t), z: 0 },
      local: tenIds.map((id, index) => ({ id, x: 0, y: index, z: 0, place: "tens" })) };
  }
  const cubes: PlaceValueCube[] = [];
  for (const id of ids) {
    const a = start.get(id), b = end.get(id);
    if (!a && b) { cubes.push({ ...b, y: b.y + (1 - t) * 2, opacity: progress === 0 ? .01 : Math.max(.1, t) }); continue; }
    if (!b && a) { if (progress < 1) cubes.push({ ...a, y: a.y + t * 2, opacity: Math.max(.01, 1 - t) }); continue; }
    if (!a || !b) continue;
    if (rotation?.ids.includes(id)) continue;
    let local = t;
    const index = hundredIds.indexOf(id);
    if (index >= 0) local = spatialActionProgress(Math.max(0, Math.min(1, progress * 10 - (9 - Math.floor(index / 10)))));
    cubes.push({ ...b, x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local + (index >= 0 ? 2 * Math.sin(Math.PI * local) : 0), z: a.z + (b.z - a.z) * local });
  }
  return { cubes, rotation };
}
export function placeValueFrame(snapshot: Pick<PlaceValueInitial, "left" | "right" | "mode" | "view">): PlaceValueInitial["frame"] {
  const sides: PlaceValueSide[] = snapshot.mode === "compare" ? ["left", "right"] : ["left"];
  const points = sides.flatMap((side) => placeValueLayout(snapshot[side]).map((p) => ({ ...p, x: p.x + (snapshot.mode === "compare" ? side === "left" ? -9 : 9 : 0) })));
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y), zs = points.map((p) => p.z);
  const x = Math.max(snapshot.mode === "compare" ? 15 : 6, ...xs) - Math.min(snapshot.mode === "compare" ? -15 : -6, ...xs);
  const y = Math.max(10, ...ys) + 3, z = Math.max(1, ...zs) - Math.min(-1, ...zs) + 1;
  const center = { x: 0, y: y / 2 - 1, z: (Math.max(1, ...zs) + Math.min(-1, ...zs)) / 2 };
  const radius = snapshot.view === "front" ? Math.max(x / 2 * .78, y / 2) : snapshot.view === "left" || snapshot.view === "right" ? Math.max(z / 2 * .78, y / 2) : Math.hypot(x, y, z) / 2;
  return { center, radius: Math.max(7.5, radius) };
}
