import { Quaternion, Vector3 } from "three";
import { newId } from "@/lib/uuid";
import { spatialActionProgress } from "../spatial-interaction/policy";
import { placeValueColorPhase, placeValueIsBlue } from "./color-policy";
import { boardHasUnit, boardTotal, compactSpans, createPlaceValueBoard, groupSize, PLACE_VALUE_HISTORY_LIMIT, PLACE_VALUE_MAX_GROUPS,
  placeValueBoardSchema, placeValueLimit, sliceGroup, type PlaceValueAction, type PlaceValueBoard, type PlaceValueChange, type PlaceValueGroup,
  type PlaceValueInitial, type PlaceValueMotion, type PlaceValueSide, type PlaceValueSnapshot, type PlaceValueSpan } from "./radix-contract";

export const PLACE_VALUE_CAMERA_TARGET = { x: 0, y: 4, z: 0 } as const;
export const placeValuePlaces = (digits: number) => Array.from({ length: digits }, (_, i) => digits - 1 - i);
export const placeValueColumn = (level: number, digits: number) => ((digits - 1) / 2 - level) * 5;
export const placeValueOffset = (mode: PlaceValueInitial["mode"], side: PlaceValueSide, digits = 3) => mode === "compare" ? (side === "left" ? -1 : 1) * (digits * 2.5 + 1.5) : 0;
export function placeValueGroup(board: PlaceValueBoard, unit: number) {
  for (let level = 0; level < board.places.length; level++) {
    const index = board.places[level].findIndex((group) => group.some((span) => unit >= span.start && unit < span.start + span.count));
    if (index >= 0) return { level, index, group: board.places[level][index] };
  }
  return null;
}
export function placeValueCarry(board: PlaceValueBoard): number | null {
  const level = board.places.findIndex((groups, level) => level < board.places.length - 1 && groups.length >= board.radix);
  return level < 0 ? null : level;
}
export function placeValuePendingCarry(snapshot: PlaceValueSnapshot, side: PlaceValueSide): number | null {
  const intent = (snapshot.motion ? [...snapshot.past, snapshot.motion] : snapshot.past).findLast((change) => change.side === side && change.kind !== "remove");
  return intent?.kind === "unpack" ? null : placeValueCarry(snapshot[side]);
}
export const placeValueProgress = (motion: PlaceValueMotion | null, now: number) => !motion ? 1 : motion.paused ? motion.progress : Math.min(1, motion.progress + Math.max(0, now - motion.startedAt) / motion.durationMs);
export const isPlaceValueRegrouping = (kind?: PlaceValueAction) => kind === "carry" || kind === "unpack";
export const placeValueLocked = (state: PlaceValueSnapshot, now = Date.now()) => isPlaceValueRegrouping(state.motion?.kind) && placeValueProgress(state.motion, now) < 1;
export function placeValueDuration(change: Pick<PlaceValueChange, "kind" | "level" | "before">, speed: PlaceValueInitial["speed"]) {
  const lower = change.kind === "unpack" ? change.level - 1 : change.level;
  return (isPlaceValueRegrouping(change.kind) ? lower > 0 ? Math.max(2400, change.before.radix * 720) : 2200 : 180) * ({ slow: 1.5, normal: 1, fast: .6 }[speed]);
}
function boundedHistory(past: PlaceValueChange[]) {
  const entries = past.slice(-PLACE_VALUE_HISTORY_LIMIT);
  while (entries.length > 1 && JSON.stringify(entries).length > 160_000) entries.shift();
  return entries;
}
export function applyPlaceValueChange(snapshot: PlaceValueSnapshot, change: PlaceValueChange, now = Date.now(), paused = false): PlaceValueSnapshot {
  return { ...snapshot, [change.side]: change.after,
    selection: snapshot.selection?.side === change.side && !boardHasUnit(change.after, snapshot.selection.unit) ? null : snapshot.selection,
    motion: { ...change, id: newId(), startedAt: now, durationMs: placeValueDuration(change, snapshot.speed), progress: 0, paused },
    past: boundedHistory([...snapshot.past, change]), future: [] };
}
export function changePlaceValueBoard(board: PlaceValueBoard, action: PlaceValueAction, level = 0, unit?: number) {
  const next = structuredClone(board), base = next.radix;
  if (action === "add") {
    if (boardTotal(next) >= placeValueLimit(base, next.places.length) || next.nextId >= 1_000_000_000_000) return null;
    next.places[0].push([{ start: next.nextId++, count: 1, phase: placeValueColorPhase(next.places[0].length) }]);
  } else if (action === "remove") { if (!next.places[0].length) return null; next.places[0].pop(); }
  else if (action === "carry") {
    if (level < 0 || level >= next.places.length - 1 || next.places[level].length < base) return null;
    next.places[level + 1].push(compactSpans(next.places[level].splice(-base).flat()));
  } else if (action === "unpack") {
    if (level < 1 || level >= next.places.length || !next.places[level].length) return null;
    const selected = unit === undefined ? null : placeValueGroup(next, unit);
    const index = selected?.level === level ? selected.index : next.places[level].length - 1;
    const group = next.places[level].splice(index, 1)[0], weight = base ** (level - 1);
    next.places[level - 1].push(...Array.from({ length: base }, (_, i) => sliceGroup(group, i * weight, weight)));
  } else return null;
  const result = placeValueBoardSchema.safeParse(next);
  return result.success ? result.data : null;
}
export function planPlaceValue(snapshot: PlaceValueSnapshot, action: PlaceValueAction, now = Date.now(), level = 0, paused = false): PlaceValueSnapshot | null {
  if (placeValueLocked(snapshot, now)) return null;
  const side = snapshot.mode === "single" ? "left" : snapshot.active, pending = placeValuePendingCarry(snapshot, side);
  if (pending !== null && (action !== "carry" || level !== pending)) return null;
  const after = changePlaceValueBoard(snapshot[side], action, level, snapshot.selection?.side === side ? snapshot.selection.unit : undefined);
  return after ? applyPlaceValueChange(snapshot, { side, before: snapshot[side], after, level, kind: action }, now, paused) : null;
}
export function planPlaceValueCount(snapshot: PlaceValueSnapshot, side: PlaceValueSide, level: number, count: number, now = Date.now()): PlaceValueSnapshot | null {
  if (placeValueLocked(snapshot, now) || placeValuePendingCarry(snapshot, side) !== null || !Number.isInteger(count) || count < 0
    || !Number.isInteger(level) || level < 0 || level >= snapshot[side].places.length) return null;
  const before = snapshot[side], current = before.places[level].length, weight = before.radix ** level;
  if (current === count || count > PLACE_VALUE_MAX_GROUPS || boardTotal(before) + (count - current) * weight > placeValueLimit(before.radix, before.places.length)) return null;
  if (level === 0 && Math.abs(count - current) === 1) return planPlaceValue({ ...snapshot, active: side }, count > current ? "add" : "remove", now);
  const after = structuredClone(before);
  if (count < current) after.places[level].splice(count);
  else for (let index = current; index < count; index++) {
    after.places[level].push([{ start: after.nextId, count: weight, phase: level ? 0 : placeValueColorPhase(index) }]); after.nextId += weight;
  }
  const parsed = placeValueBoardSchema.safeParse(after);
  return parsed.success ? applyPlaceValueChange({ ...snapshot, active: side }, { side, kind: "replace", level, before, after: parsed.data }, now) : null;
}
/** 更换进制保留两边的数量；容量不足时拒绝，不截断数字。 */
export function configurePlaceValue(snapshot: PlaceValueSnapshot, radix: number, digits: number): PlaceValueSnapshot | null {
  if (placeValueLocked(snapshot) || ["left", "right"].some((side) => placeValuePendingCarry(snapshot, side as PlaceValueSide) !== null)) return null;
  try {
    const next = { ...snapshot, left: createPlaceValueBoard(boardTotal(snapshot.left), "normal", radix, digits), right: createPlaceValueBoard(boardTotal(snapshot.right), "normal", radix, digits),
      motion: null, selection: null, highlight: "all" as const, past: [], future: [], cameraRevision: snapshot.cameraRevision + 1 };
    return { ...next, frame: placeValueFrame(next) };
  } catch { return null; }
}
export const placeValueNumeral = (count: number, base = 10) => ({ digit: Math.min(base - 1, count), extra: Math.max(0, count - base + 1) });
export function placeValueNotation(snapshot: PlaceValueSnapshot, side: PlaceValueSide, level: number, progress: number) {
  const motion = snapshot.motion?.side === side ? snapshot.motion : null, base = snapshot[side].radix;
  const after = placeValueNumeral(snapshot[side].places[level].length, base);
  const before = motion && isPlaceValueRegrouping(motion.kind) ? placeValueNumeral(motion.before.places[level].length, base) : after;
  return { before, after, blend: before.digit !== after.digit || before.extra !== after.extra ? spatialActionProgress(progress) : 1 };
}
export function pausePlaceValue(snapshot: PlaceValueSnapshot, now = Date.now()) {
  return snapshot.motion ? { ...snapshot, motion: { ...snapshot.motion, progress: placeValueProgress(snapshot.motion, now), paused: true } } : snapshot;
}
export function resumePlaceValue(snapshot: PlaceValueSnapshot, now = Date.now()) {
  return snapshot.motion ? { ...snapshot, motion: { ...snapshot.motion, startedAt: now, paused: false } } : snapshot;
}
export function historyPlaceValue(snapshot: PlaceValueSnapshot, direction: "undo" | "redo", now = Date.now()): PlaceValueSnapshot | null {
  if (placeValueLocked(snapshot, now)) return null;
  const entry = (direction === "undo" ? snapshot.past : snapshot.future).at(-1); if (!entry) return null;
  const reversed: PlaceValueChange = { ...entry, before: entry.after, after: entry.before,
    kind: entry.kind === "carry" ? "unpack" : entry.kind === "unpack" ? "carry" : "replace",
    level: entry.level + (entry.kind === "carry" ? 1 : entry.kind === "unpack" ? -1 : 0) };
  const next = applyPlaceValueChange(snapshot, direction === "undo" ? reversed : entry, now);
  return { ...next, past: direction === "undo" ? snapshot.past.slice(0, -1) : boundedHistory([...snapshot.past, entry]),
    future: direction === "undo" ? boundedHistory([...snapshot.future, entry]) : snapshot.future.slice(0, -1) };
}

type Position = { x: number; y: number; z: number };
export interface PlaceValueRod { key: number; group: PlaceValueGroup; level: number; index: number; length: number; center: Position; quaternion: [number, number, number, number]; opacity: number }
const normalRotation: PlaceValueRod["quaternion"] = [0, 0, 0, 1];
const oppositeRotation: PlaceValueRod["quaternion"] = [0, 1, 0, 0];
export function placeValueLayout(board: PlaceValueBoard): PlaceValueRod[] {
  return board.places.flatMap((groups, level) => groups.map((group, index) => ({ key: group[0].start, group, level, index, length: board.radix ** level,
    center: { x: placeValueColumn(level, board.places.length), y: index + .5, z: -(board.radix ** level - 1) / 2 },
    quaternion: level > 0 && placeValueIsBlue(index) ? oppositeRotation : normalRotation, opacity: 1 })));
}
const blendRod = (a: PlaceValueRod, b: PlaceValueRod, t: number, lift = 0): PlaceValueRod => ({ ...b,
  center: { x: a.center.x + (b.center.x - a.center.x) * t, y: a.center.y + (b.center.y - a.center.y) * t + lift * Math.sin(Math.PI * t), z: a.center.z + (b.center.z - a.center.z) * t },
  quaternion: new Quaternion(...a.quaternion).slerp(new Quaternion(...b.quaternion), t).toArray() as PlaceValueRod["quaternion"], opacity: a.opacity + (b.opacity - a.opacity) * t });
/** 长条和小方块共享刚体轨迹；动画复杂度取决于进制的组数，而非表示的数值。 */
export function placeValuePose(change: PlaceValueChange, progress: number): PlaceValueRod[] {
  if (change.kind === "unpack") return placeValuePose({ ...change, before: change.after, after: change.before, kind: "carry", level: change.level - 1 }, 1 - progress);
  const from = placeValueLayout(change.before), to = placeValueLayout(change.after);
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  const t = spatialActionProgress(progress), result: PlaceValueRod[] = [], handled = new Set<number>();
  if (change.kind === "carry") {
    const base = change.before.radix, sources = from.filter((rod) => rod.level === change.level).slice(-base);
    const parent = to.find((rod) => rod.level === change.level + 1 && !from.some((old) => old.level === rod.level && old.key === rod.key))!;
    sources.forEach((rod) => handled.add(rod.key));
    if (change.level === 0) {
      const a = { ...parent, center: { ...sources[0].center, y: (sources[0].center.y + sources.at(-1)!.center.y) / 2 },
        quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2).toArray() as PlaceValueRod["quaternion"] };
      result.push(blendRod(a, parent, t, 1.5));
    } else sources.forEach((source, index) => {
      const position = new Vector3(0, 0, (base - 1) * source.length / 2 - index * source.length).applyQuaternion(new Quaternion(...parent.quaternion));
      const target = { ...source, center: { x: parent.center.x + position.x, y: parent.center.y + position.y, z: parent.center.z + position.z }, quaternion: parent.quaternion };
      const local = spatialActionProgress(Math.max(0, Math.min(1, progress * base - (base - 1 - index))));
      result.push(blendRod(source, target, local, 2));
    });
  }
  const starts = new Map(from.map((rod) => [rod.key, rod]));
  for (const rod of to) {
    if (handled.has(rod.key)) continue;
    const old = starts.get(rod.key);
    result.push(blendRod(old ?? { ...rod, center: { ...rod.center, y: rod.center.y + 2 }, opacity: 0 }, rod, t));
  }
  const ends = new Set(to.map((rod) => rod.key));
  for (const rod of from) if (!handled.has(rod.key) && !ends.has(rod.key)) result.push(blendRod(rod, { ...rod, center: { ...rod.center, y: rod.center.y + 2 }, opacity: 0 }, t));
  return result;
}
export function placeValueRedSpans(snapshot: PlaceValueSnapshot, side: PlaceValueSide, progress: number): PlaceValueSpan[] {
  const motion = snapshot.motion?.side === side ? snapshot.motion : null;
  const board = motion && progress < 1 && motion.kind === "carry" ? motion.before : snapshot[side];
  const level = motion && progress < 1 && motion.kind === "carry" ? motion.level : placeValuePendingCarry(snapshot, side);
  return level === null ? [] : board.places[level].slice(board.radix - 1).flat();
}
export function placeValueFrame(snapshot: Pick<PlaceValueInitial, "left" | "right" | "mode" | "view">): PlaceValueInitial["frame"] {
  const digits = snapshot.left.places.length;
  const rods = (snapshot.mode === "compare" ? [snapshot.left, snapshot.right] : [snapshot.left]).flatMap(placeValueLayout);
  const x = snapshot.mode === "compare" ? digits * 5 : (digits - 1) * 2.5 + 1;
  const y = Math.max(8, ...rods.map((rod) => Math.abs(rod.center.y - 4) + 2));
  const z = Math.max(3, ...rods.map((rod) => rod.length + 1));
  const radius = snapshot.view === "front" ? Math.max(x * .78, y) : snapshot.view === "left" || snapshot.view === "right" ? Math.max(z * .78, y) : Math.hypot(x, y, z);
  return { center: { ...PLACE_VALUE_CAMERA_TARGET }, radius: Math.max(8.5, radius) };
}
export function rodUnitAt(rod: PlaceValueRod, index: number) {
  let offset = 0;
  for (const span of rod.group) { if (index < offset + span.count) return { id: span.start + index - offset, phase: span.phase + index - offset }; offset += span.count; }
  throw new Error("PLACE_VALUE_UNIT_INDEX");
}
export function rodUnitPosition(rod: PlaceValueRod, index: number) {
  const point = new Vector3(0, 0, (groupSize(rod.group) - 1) / 2 - index).applyQuaternion(new Quaternion(...rod.quaternion));
  return { x: point.x + rod.center.x, y: point.y + rod.center.y, z: point.z + rod.center.z };
}
