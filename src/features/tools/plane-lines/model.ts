import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { isValidLinesState, LINE_BOUND, LINE_LIMIT, LINE_SCENE, LINE_UNIT } from "./validation";

export type LineKind = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export interface LineMaterial { id: number; kind: LineKind; a: Point; b: Point; c: Point; q: number }
const plus = (p: Point, q: Point): Point => ({ x: p.x + q.x, y: p.y + q.y });
const minus = (p: Point, q: Point): Point => ({ x: p.x - q.x, y: p.y - q.y });
const scale = (p: Point, n: number): Point => ({ x: p.x * n, y: p.y * n });
const length = (p: Point) => Math.hypot(p.x, p.y);
export const lineAngle = (p: Point) => Math.atan2(p.y, p.x) * 180 / Math.PI;
export const linePolar = (radius: number, degrees: number): Point => ({ x: radius * Math.cos(degrees * Math.PI / 180), y: radius * Math.sin(degrees * Math.PI / 180) });
const valid = (previous: PlanarState, next: PlanarState) => isValidLinesState(next) ? next : previous;
export function emptyLinesState(): PlanarState {
  return { sceneId: LINE_SCENE, params: { count: 0, active: -1, vertex: 0 }, points: {}, flags: { grid: false, measures: false, names: false, detour: false, foot: false }, marks: [], phase: 0 };
}
export function createLinesState(): PlanarState {
  const segment = addLineMaterial(emptyLinesState(), 0, [{ x: 180, y: 230 }, { x: 400, y: 230 }, { x: 300, y: 140 }]);
  return addLineMaterial(segment, 3, [{ x: 550, y: 300 }, { x: 750, y: 240 }, { x: 660, y: 465 }]);
}
export function lineMaterial(state: PlanarState, id = state.params.active): LineMaterial | null {
  if (!Number.isInteger(id) || id < 0 || id >= state.params.count) return null;
  return { id, kind: state.params[`kind.${id}`] as LineKind, a: state.points[`a.${id}`], b: state.points[`b.${id}`], c: state.points[`c.${id}`], q: state.params[`q.${id}`] };
}
export const lineMaterials = (state: PlanarState) => Array.from({ length: state.params.count }, (_, id) => lineMaterial(state, id)!);
export function lineMetrics(object: LineMaterial) {
  const ab = minus(object.b, object.a), ac = minus(object.c, object.a), abLength = length(ab), unit = scale(ab, 1 / abLength);
  const projection = ac.x * unit.x + ac.y * unit.y, foot = plus(object.a, scale(unit, projection)), via = plus(foot, scale(unit, object.q));
  const cross = ab.x * ac.y - ab.y * ac.x, dot = ab.x * ac.x + ab.y * ac.y;
  // 同向/反向共线消除刚性转动的机器舍入；真实的小角度仍按有向叉积读出。
  const angle = Math.abs(cross) <= 1e-12 * abLength * length(ac) ? dot >= 0 ? 0 : 180 : (Math.atan2(cross, dot) * 180 / Math.PI + 360) % 360;
  return { unit, foot, via, angle, orientation: lineAngle(ab), length: abLength, secondLength: length(ac), height: length(minus(object.c, foot)), slant: length(minus(object.c, via)), detour: length(ac) + length(minus(object.c, object.b)) };
}
function replace(state: PlanarState, object: LineMaterial): PlanarState {
  const id = object.id;
  return valid(state, { ...state, params: { ...state.params, active: id, [`kind.${id}`]: object.kind, [`q.${id}`]: object.q },
    points: { ...state.points, [`a.${id}`]: object.a, [`b.${id}`]: object.b, [`c.${id}`]: object.c } });
}
export function addLineMaterial(state: PlanarState, kind: LineKind, supplied?: readonly Point[]): PlanarState {
  const id = state.params.count;
  if (id >= LINE_LIMIT) return state;
  const offset = { x: 180 + id % 4 * 75, y: 250 + Math.floor(id / 4) * 50 };
  const a = supplied?.[0] ?? offset, b = supplied?.[1] ?? plus(a, { x: kind === 4 ? 150 : 240, y: 0 });
  const ab = minus(b, a), n = length(ab);
  if (n < 1) return state;
  const c = supplied?.[2] ?? plus(a, kind === 3 ? { x: -ab.y * .8, y: ab.x * .8 } : plus(scale(ab, .5), { x: ab.y / n * 110, y: -ab.x / n * 110 }));
  return valid(state, { ...state, params: { ...state.params, count: id + 1, active: id, [`kind.${id}`]: kind, [`q.${id}`]: 100 },
    points: { ...state.points, [`a.${id}`]: a, [`b.${id}`]: b, [`c.${id}`]: c } });
}
export function duplicateLine(state: PlanarState): PlanarState {
  const object = lineMaterial(state); if (!object) return state;
  const delta = { x: 30, y: 30 }, next = addLineMaterial(state, object.kind, [plus(object.a, delta), plus(object.b, delta), plus(object.c, delta)]);
  return next === state ? state : { ...next, params: { ...next.params, [`q.${next.params.active}`]: object.q } };
}
export function removeLine(state: PlanarState): PlanarState {
  if (!lineMaterial(state)) return state;
  let next = { ...emptyLinesState(), flags: { ...state.flags } };
  for (const object of lineMaterials(state).filter((item) => item.id !== state.params.active)) {
    next = addLineMaterial(next, object.kind, [object.a, object.b, object.c]); next.params[`q.${next.params.active}`] = object.q;
  }
  return { ...next, params: { ...next.params, active: Math.min(state.params.active, next.params.count - 1), vertex: state.params.vertex } };
}
export function lineTarget(target: string | null): { id: number; part: "body" | "a" | "b" | "c" | "q" } | null {
  const match = target?.match(/^line\.(0|[1-9][0-9]*)\.(body|a|b|c|q)$/);
  return match ? { id: Number(match[1]), part: match[2] as "body" | "a" | "b" | "c" | "q" } : null;
}
export function activateLine(state: PlanarState, target: string): PlanarState {
  const hit = lineTarget(target); if (!hit || !lineMaterial(state, hit.id)) return state;
  const vertex = ["a", "b", "c"].includes(hit.part) ? ["a", "b", "c"].indexOf(hit.part) : state.params.vertex;
  return state.params.active === hit.id && state.params.vertex === vertex ? state : { ...state, params: { ...state.params, active: hit.id, vertex } };
}
export function dragLine(state: PlanarState, target: string, point: Point, delta: Point): PlanarState {
  const hit = lineTarget(target), object = hit && lineMaterial(state, hit.id); if (!hit || !object) return state;
  const base = activateLine(state, target);
  if (hit.part === "body") return replace(base, { ...object, a: plus(object.a, delta), b: plus(object.b, delta), c: plus(object.c, delta) });
  if (hit.part === "q") {
    const { foot, unit } = lineMetrics(object), relative = minus(point, foot);
    return replace(base, { ...object, q: Math.max(-LINE_BOUND, Math.min(LINE_BOUND, relative.x * unit.x + relative.y * unit.y)) });
  }
  // 角的顶点移动时带两臂平移；端点编辑保持另一条臂的真实方向。
  if (hit.part === "a" && (object.kind === 3 || object.kind === 4)) {
    const shift = minus(point, object.a); return replace(base, { ...object, a: point, b: plus(object.b, shift), c: plus(object.c, shift) });
  }
  return replace(base, { ...object, [hit.part]: point });
}
export function setLineField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  if (key === "active") return valid(state, { ...state, params: { ...state.params, active: value } });
  if (key === "vertex") return valid(state, { ...state, params: { ...state.params, vertex: value } });
  const object = lineMaterial(state); if (!object) return state;
  const metrics = lineMetrics(object), { a, b, c } = object;
  if (key === "kind") return value >= 0 && value <= 2 && Number.isInteger(value) && object.kind <= 2 ? replace(state, { ...object, kind: value as LineKind }) : state;
  if (key === "x" || key === "y") {
    const delta = { x: key === "x" ? value * LINE_UNIT - a.x : 0, y: key === "y" ? value * LINE_UNIT - a.y : 0 };
    return dragLine(state, `line.${object.id}.body`, a, delta);
  }
  if (key === "pointX" || key === "pointY") {
    const name = ["a", "b", "c"][state.params.vertex] as "a" | "b" | "c";
    const point = { ...object[name], [key === "pointX" ? "x" : "y"]: value * LINE_UNIT };
    return dragLine(state, `line.${object.id}.${name}`, point, minus(point, object[name]));
  }
  if (key === "orientation") {
    const turn = value - metrics.orientation, rotate = (p: Point) => plus(a, linePolar(length(minus(p, a)), lineAngle(minus(p, a)) + turn));
    return replace(state, { ...object, b: rotate(b), c: rotate(c) });
  }
  if (key === "length") return replace(state, { ...object, b: plus(a, linePolar(value * LINE_UNIT, metrics.orientation)) });
  if (key === "angle" && object.kind === 3 && value >= 0 && value <= 360) return replace(state, { ...object, c: plus(a, linePolar(metrics.secondLength, metrics.orientation + value)) });
  if (key === "secondLength" && object.kind === 3) return replace(state, { ...object, c: plus(a, linePolar(value * LINE_UNIT, lineAngle(minus(c, a)))) });
  if (key === "q" && object.kind >= 5) return replace(state, { ...object, q: value * LINE_UNIT });
  return state;
}
export function createLineGeometry(state: PlanarState, tool: string, points: readonly Point[]): PlanarState | null {
  const kinds: Record<string, LineKind> = { segment: 0, ray: 1, line: 2, angle: 3, protractor: 4, perpendicular: 5, parallel: 6 };
  const kind = kinds[tool]; if (kind === undefined || points.length !== (kind === 3 ? 3 : 2)) return null;
  const next = addLineMaterial(state, kind, points); return next === state ? null : next;
}
