import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { ROUTE_LIMIT, routeTargetId } from "./grid-model";

export const REFLECTION_ROUTE_SCENE = "54-create";
export const REFLECTION_ROUTE_GLOBALS = ["axisAngle", "nextId", "active", "viewX", "viewY", "viewSpan"] as const;
export const REFLECTION_ROUTE_FLAGS = ["grid", "measures", "mirror", "shortest", "names", "highlights"] as const;
export const REFLECTION_POINT_LIMIT = 1000;
export const REFLECTION_CONTACT_LIMIT = 5000;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const dot = (a: PlanarPoint, b: PlanarPoint) => a.x * b.x + a.y * b.y;
const subtract = (a: PlanarPoint, b: PlanarPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const samePoint = (a: PlanarPoint, b: PlanarPoint) => a.x === b.x && a.y === b.y;
export function reflectionDirection(state: PlanarState): PlanarPoint {
  const angle = state.params.axisAngle * Math.PI / 180;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
export const reflectionCandidateIds = (state: PlanarState) => Object.keys(state.params).filter((key) => /^contact\.(0|[1-9]\d{0,4})$/.test(key)).map((key) => Number(key.slice(8))).sort((a, b) => a - b);
export function reflectionContact(state: PlanarState, distance = state.params[`contact.${state.params.active}`]): PlanarPoint {
  const direction = reflectionDirection(state);
  return { x: state.points.axis.x + distance * direction.x, y: state.points.axis.y + distance * direction.y };
}
export function reflectionFoot(state: PlanarState, point: PlanarPoint): PlanarPoint {
  return reflectionContact(state, dot(subtract(point, state.points.axis), reflectionDirection(state)));
}
export function reflectionMirror(state: PlanarState, point = state.points.b): PlanarPoint {
  const foot = reflectionFoot(state, point);
  return { x: 2 * foot.x - point.x, y: 2 * foot.y - point.y };
}
export function reflectionFoldPoint(state: PlanarState): PlanarPoint {
  if (state.phase === 0) return { ...state.points.b };
  if (state.phase === 1) return reflectionMirror(state);
  const foot = reflectionFoot(state, state.points.b), scale = Math.cos(Math.PI * state.phase);
  return { x: foot.x + (state.points.b.x - foot.x) * scale, y: foot.y + (state.points.b.y - foot.y) * scale };
}
export function reflectionCandidateLength(state: PlanarState, id = state.params.active): number {
  const point = reflectionContact(state, state.params[`contact.${id}`]);
  return Math.hypot(point.x - state.points.a.x, point.y - state.points.a.y) + Math.hypot(point.x - state.points.b.x, point.y - state.points.b.y);
}
export interface ReflectionMinimum {
  from: number; to: number; length: number; relation: "same-side" | "opposite-side" | "on-axis";
}
/** 两点在线上时保留整段最小值集合；分居两侧用直连，同侧用镜像，不把退化情形伪装成唯一接触点。 */
export function reflectionMinimum(state: PlanarState): ReflectionMinimum {
  const direction = reflectionDirection(state), normal = { x: -direction.y, y: direction.x };
  const a = subtract(state.points.a, state.points.axis), b = subtract(state.points.b, state.points.axis);
  const ax = dot(a, direction), bx = dot(b, direction), ay = dot(a, normal), by = dot(b, normal);
  const tolerance = 1e-12 * Math.max(1, Math.hypot(a.x, a.y), Math.hypot(b.x, b.y));
  const ah = Math.abs(ay) <= tolerance ? 0 : Math.abs(ay), bh = Math.abs(by) <= tolerance ? 0 : Math.abs(by);
  if (ah + bh === 0) return { from: Math.min(ax, bx), to: Math.max(ax, bx), length: Math.abs(bx - ax), relation: "on-axis" };
  const contact = (ax * bh + bx * ah) / (ah + bh);
  return { from: contact, to: contact, length: Math.hypot(bx - ax, ah + bh), relation: ay * by < 0 && ah > 0 && bh > 0 ? "opposite-side" : ah === 0 || bh === 0 ? "on-axis" : "same-side" };
}
/** 数学坐标窗独立于轴角。整圆包络涵盖所有方向的接触点与镜像，转轴不会被旧水平舞台边界截断。 */
export function fitReflectionView(state: PlanarState): PlanarState {
  const axis = state.points.axis;
  const radius = Math.max(5, ...[state.points.a, state.points.b].map((point) => Math.hypot(point.x - axis.x, point.y - axis.y)), ...reflectionCandidateIds(state).map((id) => Math.abs(state.params[`contact.${id}`])));
  return { ...state, params: { ...state.params, viewX: axis.x, viewY: axis.y, viewSpan: Math.min(20000, radius * 2.4) } };
}
export function reflectionToStage(state: PlanarState, point: PlanarPoint): PlanarPoint {
  const scale = 440 / state.params.viewSpan;
  return { x: 450 + (point.x - state.params.viewX) * scale, y: 340 - (point.y - state.params.viewY) * scale };
}
export function reflectionFromStage(state: PlanarState, point: PlanarPoint): PlanarPoint {
  const scale = 440 / state.params.viewSpan;
  return { x: state.params.viewX + (point.x - 450) / scale, y: state.params.viewY - (point.y - 340) / scale };
}
export function createReflectionRouteState(): PlanarState {
  return fitReflectionView({ sceneId: REFLECTION_ROUTE_SCENE, params: { axisAngle: 0, nextId: 1, active: 0, viewX: 0, viewY: 0, viewSpan: 16, "contact.0": -2 }, points: { a: { x: -4, y: 5 }, b: { x: 5, y: 4 }, axis: { x: 0, y: 0 } }, flags: { grid: false, measures: false, mirror: false, shortest: false, names: true, highlights: true }, marks: [], phase: 0 });
}
export function addReflectionCandidate(state: PlanarState, copy = false, distance?: number): PlanarState {
  const ids = reflectionCandidateIds(state), id = state.params.nextId;
  if (ids.length >= ROUTE_LIMIT || id >= 99999) return state;
  const current = state.params[`contact.${state.params.active}`] ?? 0;
  const next = distance ?? (copy ? current : current + (ids.length ? current >= REFLECTION_CONTACT_LIMIT ? -1 : 1 : 0));
  if (!Number.isFinite(next) || Math.abs(next) > REFLECTION_CONTACT_LIMIT) return state;
  return { ...state, params: { ...state.params, nextId: id + 1, active: id, [`contact.${id}`]: next } };
}
export function selectReflectionCandidate(state: PlanarState, id: number): PlanarState {
  return reflectionCandidateIds(state).includes(id) && state.params.active !== id ? { ...state, params: { ...state.params, active: id } } : state;
}
export function cycleReflectionCandidate(state: PlanarState, direction: number): PlanarState {
  const ids = reflectionCandidateIds(state);
  return ids.length ? selectReflectionCandidate(state, ids[(ids.indexOf(state.params.active) + direction + ids.length) % ids.length]) : state;
}
export function removeReflectionCandidate(state: PlanarState): PlanarState {
  if (state.params.active === -1) return state;
  const params = { ...state.params };
  delete params[`contact.${params.active}`]; params.active = reflectionCandidateIds(state).find((id) => id !== state.params.active) ?? -1;
  return { ...state, params };
}
export function setReflectionPoint(state: PlanarState, key: "a" | "b" | "axis", point: PlanarPoint): PlanarState {
  if (![point.x, point.y].every((value) => Number.isFinite(value) && Math.abs(value) <= REFLECTION_POINT_LIMIT) || samePoint(point, state.points[key])) return state;
  return { ...state, points: { ...state.points, [key]: { ...point } } };
}
export function setReflectionRouteField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  if (key === "candidate") return Number.isInteger(value) ? selectReflectionCandidate(state, value - 1) : state;
  if (key === "axisAngle") return Math.abs(value) <= 180 ? { ...state, params: { ...state.params, axisAngle: value } } : state;
  if (key === "contact") return state.params.active >= 0 && Math.abs(value) <= REFLECTION_CONTACT_LIMIT ? fitReflectionView({ ...state, params: { ...state.params, [`contact.${state.params.active}`]: value } }) : state;
  const match = /^(a|b|axis)(X|Y)$/.exec(key);
  if (!match) return state;
  const point = match[1] as "a" | "b" | "axis", next = setReflectionPoint(state, point, { ...state.points[point], [match[2].toLowerCase()]: value });
  return next === state ? state : fitReflectionView(next);
}
export function setReflectionRouteFlag(state: PlanarState, key: string, value: boolean): PlanarState {
  if (!(REFLECTION_ROUTE_FLAGS as readonly string[]).includes(key) || key === "grid") return state;
  return { ...state, flags: { ...state.flags, [key]: value }, phase: key === "mirror" ? value ? 1 : 0 : state.phase };
}
export function tapReflectionRoute(state: PlanarState, target: string): PlanarState {
  const id = routeTargetId(target);
  return id === null ? state : selectReflectionCandidate(state, id);
}
export function dragReflectionRoute(start: PlanarState, target: string, at: PlanarPoint, delta: PlanarPoint): PlanarState {
  const scale = start.params.viewSpan / 440, change = { x: delta.x * scale, y: -delta.y * scale };
  if (["a", "b", "axis"].includes(target)) {
    const key = target as "a" | "b" | "axis", original = start.points[key];
    return setReflectionPoint(start, key, { x: clamp(original.x + change.x, -REFLECTION_POINT_LIMIT, REFLECTION_POINT_LIMIT), y: clamp(original.y + change.y, -REFLECTION_POINT_LIMIT, REFLECTION_POINT_LIMIT) });
  }
  if (target === "axis-turn") {
    const point = reflectionFromStage(start, at), axis = start.points.axis;
    return Math.hypot(point.x - axis.x, point.y - axis.y) <= 1e-8 ? start : { ...start, params: { ...start.params, axisAngle: Math.atan2(point.y - axis.y, point.x - axis.x) * 180 / Math.PI } };
  }
  const id = routeTargetId(target);
  if (id === null || !reflectionCandidateIds(start).includes(id)) return start;
  return { ...start, params: { ...start.params, active: id, [`contact.${id}`]: clamp(start.params[`contact.${id}`] + dot(change, reflectionDirection(start)), -REFLECTION_CONTACT_LIMIT, REFLECTION_CONTACT_LIMIT) } };
}
export function constructReflectionRoute(state: PlanarState, tool: string, stagePoints: readonly PlanarPoint[]): PlanarState | null {
  if (!stagePoints.length) return null;
  const points = stagePoints.map((point) => reflectionFromStage(state, point));
  if (tool === "a" || tool === "b") {
    const next = setReflectionPoint(state, tool, points[0]);
    return next === state ? null : fitReflectionView(next);
  }
  if (tool === "contact") {
    const next = addReflectionCandidate(state, false, dot(subtract(points[0], state.points.axis), reflectionDirection(state)));
    return next === state ? null : fitReflectionView(next);
  }
  if (tool !== "axis" || points.length < 2 || Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) <= 1e-8 || ![points[0].x, points[0].y].every((value) => Math.abs(value) <= REFLECTION_POINT_LIMIT)) return null;
  const angle = Math.atan2(points.at(-1)!.y - points[0].y, points.at(-1)!.x - points[0].x) * 180 / Math.PI;
  return fitReflectionView({ ...state, points: { ...state.points, axis: points[0] }, params: { ...state.params, axisAngle: angle } });
}
