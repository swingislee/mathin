import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { matchEndpoints, snapMatch, type Matchstick } from "../plane-patterns/model";

export const MATCH_SCENE = "51-create";
export const MATCH_LIMIT = 96;
export const MATCH_LENGTH = 100;
export const MATCH_FLAGS = ["grid", "measures", "snap", "reference", "labels"] as const;
export type MatchMaterial = "single" | "triangle" | "square" | "shared";
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const pointInStage = (p: PlanarPoint) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 40 && p.x <= 920 && p.y >= 40 && p.y <= 680;
const ids = (state: PlanarState, prefix: string) => Object.keys(state.params).filter((key) => key.startsWith(`${prefix}.`)).map((key) => Number(key.slice(prefix.length + 1))).sort((a, b) => a - b);
export const matchIds = (state: PlanarState) => ids(state, "angle");
export const referenceIds = (state: PlanarState) => ids(state, "referenceAngle");
export function matchTarget(target: string | null): number | null {
  const result = /^(?:stick|turn)\.(0|[1-9]\d{0,4})$/.exec(target ?? "");
  return result ? Number(result[1]) : null;
}
export function matchFor(state: PlanarState, id = state.params.active, reference = false): Matchstick | null {
  const center = state.points[`${reference ? "reference" : "stick"}.${id}`], angle = state.params[`${reference ? "referenceAngle" : "angle"}.${id}`];
  return center && angle !== undefined ? { id: `stick.${id}`, center, angle, length: MATCH_LENGTH } : null;
}
export const liveMatches = (state: PlanarState) => matchIds(state).map((id) => matchFor(state, id)!);
export function createMatchState(): PlanarState {
  return addMatchMaterial({ sceneId: MATCH_SCENE, params: { nextId: 0, active: -1, turn: 45 }, points: {}, flags: { grid: false, measures: false, snap: true, reference: false, labels: false }, marks: [], phase: 0 }, "single");
}
function appendMatches(state: PlanarState, pieces: readonly { center: PlanarPoint; angle: number }[]): PlanarState {
  if (!pieces.length || matchIds(state).length + pieces.length > MATCH_LIMIT || state.params.nextId + pieces.length > 99999 || pieces.some((piece) => !pointInStage(piece.center))) return state;
  const params = { ...state.params }, points = { ...state.points };
  pieces.forEach((piece, index) => { const id = state.params.nextId + index; params[`angle.${id}`] = piece.angle; points[`stick.${id}`] = { ...piece.center }; });
  params.active = state.params.nextId; params.nextId += pieces.length;
  return { ...state, params, points };
}
/** 快捷组合只是追加的等长材料，每根棒仍独立；不替换当前现场。 */
export function addMatchMaterial(state: PlanarState, kind: MatchMaterial): PlanarState {
  const shift = (matchIds(state).length % 5) * 18, x = 350 + shift, y = 330 + shift;
  if (kind === "single") return appendMatches(state, [{ center: { x: x + 50, y }, angle: 0 }]);
  const segments: [PlanarPoint, PlanarPoint][] = kind === "triangle"
    ? [[{ x, y }, { x: x + 100, y }], [{ x: x + 100, y }, { x: x + 50, y: y - 50 * Math.sqrt(3) }], [{ x: x + 50, y: y - 50 * Math.sqrt(3) }, { x, y }]]
    : [...Array.from({ length: kind === "shared" ? 3 : 1 }, (_, i): [PlanarPoint, PlanarPoint][] => [
      [{ x: x + i * 100, y }, { x: x + (i + 1) * 100, y }], [{ x: x + i * 100, y: y - 100 }, { x: x + (i + 1) * 100, y: y - 100 }],
    ]).flat(), ...Array.from({ length: kind === "shared" ? 4 : 2 }, (_, i): [PlanarPoint, PlanarPoint] => [{ x: x + i * 100, y }, { x: x + i * 100, y: y - 100 }])];
  return appendMatches(state, segments.map(([a, b]) => ({ center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI })));
}
export function selectMatch(state: PlanarState, target: string | null): PlanarState {
  const id = matchTarget(target);
  return id !== null && matchFor(state, id) && state.params.active !== id ? { ...state, params: { ...state.params, active: id } } : state;
}
export function duplicateMatch(state: PlanarState, target: string | null): PlanarState {
  const id = matchTarget(target), piece = id === null ? null : matchFor(state, id);
  return piece ? appendMatches(state, [{ center: { x: piece.center.x > 870 ? piece.center.x - 30 : piece.center.x + 30, y: piece.center.y > 630 ? piece.center.y - 30 : piece.center.y + 30 }, angle: piece.angle }]) : state;
}
export function removeMatch(state: PlanarState, target: string | null): PlanarState {
  const id = matchTarget(target);
  if (id === null || !matchFor(state, id)) return state;
  const params = { ...state.params }, points = { ...state.points };
  delete params[`angle.${id}`]; delete points[`stick.${id}`];
  params.active = matchIds(state).find((other) => other !== id) ?? -1;
  return { ...state, params, points };
}
export function clearMatchReference(state: PlanarState): PlanarState {
  return { ...state, params: Object.fromEntries(Object.entries(state.params).filter(([key]) => !key.startsWith("referenceAngle."))), points: Object.fromEntries(Object.entries(state.points).filter(([key]) => !key.startsWith("reference."))), flags: { ...state.flags, reference: false } };
}
export function captureMatchReference(state: PlanarState): PlanarState {
  const next = clearMatchReference(state);
  for (const id of matchIds(state)) { next.params[`referenceAngle.${id}`] = state.params[`angle.${id}`]; next.points[`reference.${id}`] = { ...state.points[`stick.${id}`] }; }
  return { ...next, flags: { ...next.flags, reference: true } };
}
export function clearMatches(state: PlanarState): PlanarState {
  return { ...state, params: { nextId: state.params.nextId, active: -1, turn: state.params.turn }, points: {}, flags: { ...state.flags, reference: false } };
}
export function setMatchField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  if (key === "turn") return { ...state, params: { ...state.params, turn: clamp(value, -360, 360) } };
  const piece = matchFor(state);
  if (!piece) return state;
  if (key === "angle") return { ...state, params: { ...state.params, [`angle.${state.params.active}`]: clamp(value, -36000, 36000) } };
  if (key === "x" || key === "y") return { ...state, points: { ...state.points, [piece.id]: { ...piece.center, [key]: clamp(value, 40, key === "x" ? 920 : 680) } } };
  return state;
}
export function turnMatch(state: PlanarState, target: string | null, amount: number): PlanarState {
  const id = matchTarget(target), piece = id === null ? null : matchFor(state, id);
  return piece && id !== null ? { ...state, params: { ...state.params, active: id, [`angle.${id}`]: clamp(piece.angle + amount, -36000, 36000) } } : state;
}
export function dragMatch(start: PlanarState, target: string, at: PlanarPoint, delta: PlanarPoint, previous = start): PlanarState {
  const id = matchTarget(target), piece = id === null ? null : matchFor(start, id);
  if (!piece || id === null) return start;
  const selected = { ...start, params: { ...start.params, active: id } };
  if (target.startsWith("turn.")) {
    if (Math.hypot(at.x - piece.center.x, at.y - piece.center.y) < 5) return previous;
    const pointerAngle = (p: PlanarPoint) => Math.atan2(p.y - piece.center.y, p.x - piece.center.x) * 180 / Math.PI;
    const raw = piece.angle + pointerAngle(at) - pointerAngle({ x: at.x - delta.x, y: at.y - delta.y });
    const prior = previous.params[`angle.${id}`], continuous = raw + 360 * Math.round((prior - raw) / 360);
    return { ...selected, params: { ...selected.params, [`angle.${id}`]: clamp(continuous, -36000, 36000) } };
  }
  return { ...selected, points: { ...start.points, [piece.id]: { x: clamp(piece.center.x + delta.x, 40, 920), y: clamp(piece.center.y + delta.y, 40, 680) } } };
}
export function settleMatch(state: PlanarState, target: string): PlanarState | null {
  if (!state.flags.snap || target.startsWith("turn.")) return null;
  const id = matchTarget(target), piece = id === null ? null : matchFor(state, id);
  if (!piece) return null;
  const snapped = snapMatch(piece, liveMatches(state).filter((other) => other.id !== piece.id));
  return pointInStage(snapped.center) ? { ...state, points: { ...state.points, [piece.id]: snapped.center } } : state;
}
export function matchBounds(piece: Matchstick) {
  const [a, b] = matchEndpoints(piece);
  return { minX: Math.min(a.x, b.x) - 10, minY: Math.min(a.y, b.y) - 10, maxX: Math.max(a.x, b.x) + 10, maxY: Math.max(a.y, b.y) + 10 };
}
