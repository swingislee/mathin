import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { constructionMatrix, constructionObject, constructionObjects, worldVertices } from "../plane-construction/model";
import { createPerimeterGeometry, PERIMETER_UNIT, setPerimeterField } from "../plane-perimeter/model";
import { staircasePolygon } from "../plane-geometry/model";
import { add, cross, distance, dot, length, polygonUnionBoundary, scale, subtract, type UnionBoundary } from "./geometry";
import { BOUNDARY_FLAGS, liftPerimeterState, perimeterBaseState } from "./state";
import { isValidPerimeterBoundaryState } from "./validation";
export * from "./state";
export * from "./geometry";
export { isValidPerimeterBoundaryState } from "./validation";

const checked = (before: PlanarState, next: PlanarState) => isValidPerimeterBoundaryState(next) ? next : before;
export function changePerimeterBase(state: PlanarState, change: (base: PlanarState) => PlanarState): PlanarState {
  const base = perimeterBaseState(state), next = change(base); return next === base ? state : checked(state, liftPerimeterState(state, next));
}
export function boundaryUnion(state: PlanarState): UnionBoundary {
  return polygonUnionBoundary(constructionObjects(state).filter((object) => state.params[`unionMember.${object.id}`] === 1).map((object) => ({ id: object.id, points: worldVertices(object) })));
}
export function setUnionMember(state: PlanarState, id = state.params.active, member?: boolean): PlanarState {
  if (!constructionObject(state, id)) return state;
  const value = member === undefined ? 1 - state.params[`unionMember.${id}`] : member ? 1 : 0;
  return value === state.params[`unionMember.${id}`] ? state : { ...state, params: { ...state.params, [`unionMember.${id}`]: value } };
}
export function setAllUnionMembers(state: PlanarState, member: boolean): PlanarState { return constructionObjects(state).reduce((next, object) => setUnionMember(next, object.id, member), state); }
export const edgeCopySource = (state: PlanarState) => constructionObject(state, state.params.edgeSource);
const worldVector = (state: PlanarState, point: Point) => { const object = edgeCopySource(state)!; const [a, b, c, d] = constructionMatrix(object); return { x: a * point.x + c * point.y, y: b * point.x + d * point.y }; };
const localVector = (state: PlanarState, point: Point) => { const object = edgeCopySource(state)!; const [a, b, c, d] = constructionMatrix(object), determinant = a * d - b * c; return { x: (d * point.x - c * point.y) / determinant, y: (-b * point.x + a * point.y) / determinant }; };
export function edgeCopies(state: PlanarState) {
  const source = edgeCopySource(state); if (!source) return [];
  const original = worldVertices(source);
  return original.map((a, index) => { const b = original[(index + 1) % original.length], offset = worldVector(state, state.points[`edgeMove.${index}`]); return { index, a: add(a, offset), b: add(b, offset), originalA: a, originalB: b, offset, length: distance(a, b) }; });
}
export function clearEdgeCopies(state: PlanarState): PlanarState {
  if (state.params.edgeSource === -1) return state;
  return { ...state, params: { ...state.params, edgeSource: -1, edgeActive: -1 }, points: Object.fromEntries(Object.entries(state.points).filter(([key]) => !key.startsWith("edgeMove."))) };
}
export function extractEdgeCopies(state: PlanarState): PlanarState {
  const source = constructionObject(state); if (!source) return state;
  const cleared = clearEdgeCopies(state), points = { ...cleared.points }; source.vertices.forEach((_, i) => { points[`edgeMove.${i}`] = { x: 0, y: 0 }; });
  return checked(state, { ...cleared, params: { ...cleared.params, edgeSource: source.id, edgeActive: 0 }, points });
}
export function restoreEdgeCopies(state: PlanarState, onlyActive = false): PlanarState {
  const source = edgeCopySource(state); if (!source) return state;
  const points = { ...state.points }; let changed = false;
  source.vertices.forEach((_, i) => { const key = `edgeMove.${i}`; if ((!onlyActive || i === state.params.edgeActive) && (points[key].x !== 0 || points[key].y !== 0)) { points[key] = { x: 0, y: 0 }; changed = true; } });
  return changed ? { ...state, points } : state;
}
/** 用纸片本身的两组垂直方向识别台阶；不把斜边投影成水平或竖直边。 */
export function orthogonalEdgeFrame(state: PlanarState) {
  const source = edgeCopySource(state); if (!source) return null;
  const vertices = source.vertices, first = subtract(vertices[1], vertices[0]), u = scale(first, 1 / length(first)), v = { x: -u.y, y: u.x };
  const eps = 32 * Number.EPSILON * Math.max(1, ...vertices.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
  const edges = vertices.map((a, index) => { const b = vertices[(index + 1) % vertices.length], d = subtract(b, a); return { a, b, index, length: length(d), along: dot(u, d), across: cross(u, d), group: Math.abs(cross(u, d)) <= eps ? 0 : Math.abs(dot(u, d)) <= eps ? 1 : -1 }; });
  if (edges.some((edge) => edge.group < 0)) return null;
  const x = vertices.map((p) => dot(p, u)), y = vertices.map((p) => dot(p, v)), minU = Math.min(...x), maxU = Math.max(...x), minV = Math.min(...y), maxV = Math.max(...y);
  const horizontal = edges.filter((edge) => edge.group === 0).reduce((sum, edge) => sum + edge.length, 0), vertical = edges.filter((edge) => edge.group === 1).reduce((sum, edge) => sum + edge.length, 0);
  return { source, edges, u, v, minU, maxU, minV, maxV, horizontal, vertical, perimeter: horizontal + vertical, referencePerimeter: 2 * (maxU - minU + maxV - minV) };
}
export function collectEdgeCopies(state: PlanarState): PlanarState {
  const frame = orthogonalEdgeFrame(state); if (!frame) return state;
  const points = { ...state.points }; let horizontal = 0, vertical = 0;
  for (const edge of frame.edges) {
    const isHorizontal = edge.group === 0, direction = isHorizontal ? frame.u : frame.v;
    const anchor = isHorizontal ? add(scale(frame.u, frame.minU), scale(frame.v, frame.maxV + 75)) : add(scale(frame.u, frame.maxU + 75), scale(frame.v, frame.minV));
    const offset = (isHorizontal ? horizontal : vertical) + ((isHorizontal ? edge.along : edge.across) < 0 ? edge.length : 0), target = add(anchor, scale(direction, offset));
    points[`edgeMove.${edge.index}`] = subtract(target, edge.a);
    if (isHorizontal) horizontal += edge.length; else vertical += edge.length;
  }
  return checked(state, { ...state, points });
}
export function interpolateEdgeCopies(from: PlanarState, to: PlanarState, progress: number): PlanarState {
  if (progress >= 1) return to; if (progress <= 0) return from;
  if (from.params.edgeSource !== to.params.edgeSource) return from;
  const source = edgeCopySource(to); if (!source) return from;
  const points = { ...to.points }; source.vertices.forEach((_, i) => { const key = `edgeMove.${i}`, a = from.points[key], b = to.points[key]; points[key] = add(a, scale(subtract(b, a), progress)); });
  return { ...to, points };
}
export function parseEdgeCopyTarget(target: string) { const match = /^edge-copy\.(0|[1-9]|[12]\d|3[01])$/.exec(target); return match ? Number(match[1]) : null; }
export function selectEdgeCopy(state: PlanarState, target: string): PlanarState {
  const index = parseEdgeCopyTarget(target), source = edgeCopySource(state);
  return index !== null && source && index < source.vertices.length ? { ...state, params: { ...state.params, active: source.id, edgeActive: index } } : state;
}
export function dragEdgeCopy(state: PlanarState, target: string, delta: Point): PlanarState {
  const index = parseEdgeCopyTarget(target), source = edgeCopySource(state);
  if (index === null || !source || index >= source.vertices.length || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return state;
  return checked(state, { ...selectEdgeCopy(state, target), points: { ...state.points, [`edgeMove.${index}`]: add(state.points[`edgeMove.${index}`], localVector(state, delta)) } });
}
export function setPerimeterBoundaryField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  if (key === "unionMember") return value === 0 || value === 1 ? setUnionMember(state, state.params.active, value === 1) : state;
  if (key === "edgeActive") return checked(state, { ...state, params: { ...state.params, edgeActive: value } });
  if (key === "edgeDx" || key === "edgeDy") {
    const source = edgeCopySource(state); if (!source) return state;
    const index = state.params.edgeActive, old = worldVector(state, state.points[`edgeMove.${index}`]), next = { ...old, [key === "edgeDx" ? "x" : "y"]: value * PERIMETER_UNIT };
    return checked(state, { ...state, points: { ...state.points, [`edgeMove.${index}`]: localVector(state, next) } });
  }
  return changePerimeterBase(state, (base) => setPerimeterField(base, key, value));
}
export function setPerimeterBoundaryFlag(state: PlanarState, key: string, value: boolean, baseSetFlag: (s: PlanarState, key: string, value: boolean) => PlanarState): PlanarState {
  return BOUNDARY_FLAGS.includes(key as typeof BOUNDARY_FLAGS[number]) ? { ...state, flags: { ...state.flags, [key]: value } } : changePerimeterBase(state, (base) => baseSetFlag(base, key, value));
}
export function createBoundaryGeometry(state: PlanarState, tool: string, input: readonly Point[]): PlanarState | null {
  const base = createPerimeterGeometry(perimeterBaseState(state), tool, input); if (!base) return null;
  const next = liftPerimeterState(state, base); return isValidPerimeterBoundaryState(next) ? next : null;
}
export function addStaircaseMaterial(state: PlanarState, notch = false): PlanarState {
  const at = constructionObjects(state).length, origin = { x: 230 + at % 4 * 35, y: 190 + at % 3 * 30 };
  return createBoundaryGeometry(state, "polygon", staircasePolygon(210, 150, 3, notch ? 36 : 0).map((point) => add(point, origin))) ?? state;
}
