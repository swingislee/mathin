import { placeValueInitialSchema as legacyInitialSchema, placeValueSnapshotSchema as legacySnapshotSchema,
  type PlaceValueBoard as LegacyBoard, type PlaceValueInitial as LegacyInitial, type PlaceValueSnapshot as LegacySnapshot, type PlaceValueChange as LegacyChange } from "./contract";
import { compactSpans, placeValueInitialSchema, type PlaceValueBoard, type PlaceValueChange, type PlaceValueGroup, type PlaceValueInitial, type PlaceValueSnapshot } from "./radix-contract";

const oldPlaces = ["ones", "tens", "hundreds"] as const;
function upgradeGroup(ids: number[]): PlaceValueGroup {
  const spans: PlaceValueGroup = [];
  for (const id of ids) {
    const start = Math.floor(id / 2), color = id % 2, last = spans.at(-1);
    const phase = last && last.start + last.count === start && ((last.phase + last.count) % 10 >= 5 ? 1 : 0) === color ? (last.phase + last.count) % 10 : color * 5;
    spans.push({ start, count: 1, phase });
    const merged = compactSpans(spans, 10); spans.splice(0, spans.length, ...merged);
  }
  return spans;
}
export function upgradePlaceValueBoard(board: LegacyBoard): PlaceValueBoard {
  return { radix: 10, places: [board.ones.map((id) => upgradeGroup([id])), board.tens.map(upgradeGroup), board.hundreds.map((group) => upgradeGroup(group.flat()))], nextId: board.nextId };
}
function downgradeBoard(board: PlaceValueBoard): LegacyBoard {
  const ids = (group: PlaceValueGroup) => group.flatMap((span) => Array.from({ length: span.count }, (_, i) => (span.start + i) * 2 + ((span.phase + i) % 10 >= 5 ? 1 : 0)));
  return { ones: board.places[0].flatMap(ids), tens: board.places[1].map(ids), hundreds: board.places[2].map((group) => {
    const members = ids(group); return Array.from({ length: 10 }, (_, i) => members.slice(i * 10, i * 10 + 10));
  }), nextId: board.nextId };
}
export function upgradePlaceValueInitial(initial: LegacyInitial): PlaceValueInitial {
  return placeValueInitialSchema.parse({ ...initial, left: upgradePlaceValueBoard(initial.left), right: upgradePlaceValueBoard(initial.right),
    highlight: initial.highlight === "all" ? "all" : oldPlaces.indexOf(initial.highlight),
    selection: initial.selection ? { ...initial.selection, unit: Math.floor(initial.selection.unit / 2) } : null });
}
export function downgradePlaceValueInitial(initial: PlaceValueInitial): LegacyInitial {
  if (initial.left.radix !== 10 || initial.left.places.length !== 3) throw new Error("LEGACY_PLACE_VALUE_RANGE");
  const left = downgradeBoard(initial.left), right = downgradeBoard(initial.right);
  const selectedBoard = initial.selection?.side === "right" ? right : left;
  const selected = initial.selection && [...selectedBoard.ones, ...selectedBoard.tens.flat(), ...selectedBoard.hundreds.flat(2)].find((id) => Math.floor(id / 2) === initial.selection!.unit);
  return legacyInitialSchema.parse({ ...initial, left, right, highlight: initial.highlight === "all" ? "all" : oldPlaces[initial.highlight],
    selection: initial.selection && selected !== undefined ? { side: initial.selection.side, unit: selected } : null });
}
const upgradeChange = (change: LegacyChange): PlaceValueChange => ({ side: change.side, before: upgradePlaceValueBoard(change.before), after: upgradePlaceValueBoard(change.after),
  kind: change.kind.startsWith("carry-") ? "carry" : change.kind.startsWith("unpack-") ? "unpack" : change.kind as "add" | "remove" | "replace",
  level: change.kind === "carry-ten" || change.kind === "unpack-ten" ? 1 : change.kind === "unpack-hundred" ? 2 : 0 });
const downgradeChange = (change: PlaceValueChange): LegacyChange => ({ side: change.side, before: downgradeBoard(change.before), after: downgradeBoard(change.after),
  kind: change.kind === "carry" ? change.level === 0 ? "carry-one" : "carry-ten" : change.kind === "unpack" ? change.level === 1 ? "unpack-ten" : "unpack-hundred" : change.kind });
export function upgradePlaceValueSnapshot(state: LegacySnapshot): PlaceValueSnapshot {
  // v1 的历史成员顺序保留；渲染与交互复用 v2，wire identity 不改写。
  const initial = Object.fromEntries(Object.keys(legacyInitialSchema.shape).map((key) => [key, state[key as keyof LegacyInitial]])) as LegacyInitial;
  return { ...upgradePlaceValueInitial(initial), cameraRevision: state.cameraRevision, past: state.past.map(upgradeChange), future: state.future.map(upgradeChange),
    motion: state.motion ? { ...state.motion, ...upgradeChange(state.motion) } : null };
}
export function downgradePlaceValueSnapshot(state: PlaceValueSnapshot): LegacySnapshot {
  const initial = Object.fromEntries(Object.keys(placeValueInitialSchema.shape).map((key) => [key, state[key as keyof PlaceValueInitial]])) as PlaceValueInitial;
  return legacySnapshotSchema.parse({ ...downgradePlaceValueInitial(initial), cameraRevision: state.cameraRevision, past: state.past.map(downgradeChange), future: state.future.map(downgradeChange),
    motion: state.motion ? { ...downgradeChange(state.motion), id: state.motion.id, startedAt: state.motion.startedAt, durationMs: state.motion.durationMs, progress: state.motion.progress, paused: state.motion.paused } : null });
}
