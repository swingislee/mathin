import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { rollingCircle, unwrapAngle } from "../plane-motion/model";
import { ROLLING_FLAGS, ROLLING_LIMIT, ROLLING_OBSERVATIONS, ROLLING_PARAMS, ROLLING_SCENE } from "./constants";
import { isValidRollingWorkbenchState } from "./validation";

export interface RollingPair { id: number; center: Point; R: number; r: number; angle: number; inside: boolean }
export const rollingIds = (state: PlanarState) => Object.keys(state.params).filter((key) => /^R\.(0|[1-9]\d{0,4})$/.test(key)).map((key) => Number(key.slice(2))).sort((a, b) => a - b);
export function rollingPair(state: PlanarState, id = state.params.active): RollingPair | null {
  const center = state.points[`center.${id}`];
  return center ? { id, center, R: state.params[`R.${id}`], r: state.params[`r.${id}`], angle: state.params[`angle.${id}`], inside: state.flags[`inside.${id}`] } : null;
}
export const rollingPairs = (state: PlanarState) => rollingIds(state).map((id) => rollingPair(state, id)!);
export function rollingTarget(target: string | null) {
  const match = /^(pair|roll|center|radius|roller)\.(0|[1-9]\d{0,4})$/.exec(target ?? "");
  return match ? { kind: match[1], id: Number(match[2]) } : null;
}
const checked = (before: PlanarState, after: PlanarState) => isValidRollingWorkbenchState(after) ? after : before;
const finitePoint = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y);
export const rollingScale = (state: PlanarState) => 440 / state.params.viewSpan;
export const rollingToStage = (point: Point, state: PlanarState): Point => ({ x: 450 + (point.x - state.params.viewX) * rollingScale(state), y: 340 - (point.y - state.params.viewY) * rollingScale(state) });
export const rollingFromStage = (point: Point, state: PlanarState): Point => ({ x: state.params.viewX + (point.x - 450) / rollingScale(state), y: state.params.viewY - (point.y - 340) / rollingScale(state) });
export const rollingExtent = (pair: RollingPair) => pair.inside ? pair.R : pair.R + 2 * pair.r;
export function rollingPose(pair: RollingPair) { return rollingCircle(pair.R, pair.r, pair.angle, pair.inside, pair.center); }

/** 视窗包住完整绕行范围；滚动与手势本身保持起拖时的映射。 */
export function fitRollingView(state: PlanarState): PlanarState {
  const pairs = rollingPairs(state);
  if (!pairs.length) return state;
  const minX = Math.min(...pairs.map((pair) => pair.center.x - rollingExtent(pair))), maxX = Math.max(...pairs.map((pair) => pair.center.x + rollingExtent(pair)));
  const minY = Math.min(...pairs.map((pair) => pair.center.y - rollingExtent(pair))), maxY = Math.max(...pairs.map((pair) => pair.center.y + rollingExtent(pair)));
  return { ...state, params: { ...state.params, viewX: (minX + maxX) / 2, viewY: (minY + maxY) / 2, viewSpan: Math.max(1, (maxY - minY) * 1.2, (maxX - minX) * 1.2 * 440 / 800) } };
}
function writePair(state: PlanarState, pair: RollingPair): PlanarState {
  return { ...state, params: { ...state.params, active: pair.id, [`R.${pair.id}`]: pair.R, [`r.${pair.id}`]: pair.r, [`angle.${pair.id}`]: pair.angle },
    points: { ...state.points, [`center.${pair.id}`]: { ...pair.center } }, flags: { ...state.flags, [`inside.${pair.id}`]: pair.inside } };
}
export function addRollingPair(state: PlanarState, source?: RollingPair): PlanarState {
  const id = state.params.nextId, count = rollingIds(state).length;
  if (count >= ROLLING_LIMIT || id >= 99999) return state;
  const pair = source ? { ...source, id, center: { x: source.center.x + (source.center.x <= 992 ? 8 : -8), y: source.center.y } }
    : { id, center: { x: count % 2 * 12, y: -Math.floor(count / 2) * 12 }, R: 3.5, r: 1.1, angle: 0, inside: false };
  const next = writePair({ ...state, params: { ...state.params, nextId: id + 1 } }, pair);
  for (const key of ROLLING_OBSERVATIONS) next.flags[`${key}.${id}`] = key === "inside" ? pair.inside : source ? state.flags[`${key}.${source.id}`] : false;
  return checked(state, fitRollingView(next));
}
export function createRollingWorkbenchState(): PlanarState {
  return addRollingPair({ sceneId: ROLLING_SCENE, params: { nextId: 0, active: -1, rollBy: 360, viewX: 0, viewY: 0, viewSpan: 14 }, points: {},
    flags: Object.fromEntries(ROLLING_FLAGS.map((key) => [key, false])), marks: [], phase: 0 });
}
export function selectRollingPair(state: PlanarState, target: string | null): PlanarState {
  const parsed = rollingTarget(target);
  return parsed && rollingPair(state, parsed.id) && parsed.id !== state.params.active ? { ...state, params: { ...state.params, active: parsed.id } } : state;
}
export function duplicateRollingPair(state: PlanarState): PlanarState { const pair = rollingPair(state); return pair ? addRollingPair(state, pair) : state; }
export function removeRollingPair(state: PlanarState): PlanarState {
  const pair = rollingPair(state);
  if (!pair) return state;
  const params = { ...state.params }, points = { ...state.points }, flags = { ...state.flags };
  for (const key of ROLLING_PARAMS) delete params[`${key}.${pair.id}`];
  for (const key of ROLLING_OBSERVATIONS) delete flags[`${key}.${pair.id}`];
  delete points[`center.${pair.id}`]; params.active = rollingIds(state).find((id) => id !== pair.id) ?? -1;
  return fitRollingView({ ...state, params, points, flags });
}
export function setRollingField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  if (key === "rollBy") return checked(state, { ...state, params: { ...state.params, rollBy: value } });
  const pair = rollingPair(state);
  if (!pair) return state;
  const changed = key === "x" || key === "y" ? { ...pair, center: { ...pair.center, [key]: value } }
    : key === "R" || key === "r" || key === "angle" ? { ...pair, [key]: value }
      : key === "mode" && (value === 0 || value === 1) ? { ...pair, inside: value === 1 } : null;
  if (!changed) return state;
  const candidate = writePair(state, changed);
  return checked(state, key === "angle" ? candidate : fitRollingView(candidate));
}
export function setRollingFlag(state: PlanarState, key: string, value: boolean): PlanarState {
  if (["measures", "names"].includes(key)) return { ...state, flags: { ...state.flags, [key]: value } };
  if (!(ROLLING_OBSERVATIONS as readonly string[]).includes(key) || !rollingPair(state)) return state;
  if (key === "inside") return setRollingField(state, "mode", value ? 1 : 0);
  return { ...state, flags: { ...state.flags, [`${key}.${state.params.active}`]: value } };
}
export function rollCurrentPair(state: PlanarState, amount = state.params.rollBy): PlanarState {
  const pair = rollingPair(state);
  return pair && amount !== 0 ? checked(state, writePair(state, { ...pair, angle: pair.angle + amount })) : state;
}
export function interpolateRolling(from: PlanarState, to: PlanarState, progress: number): PlanarState {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  const params = { ...to.params };
  for (const pair of rollingPairs(to)) { const before = rollingPair(from, pair.id); if (before) params[`angle.${pair.id}`] = before.angle + (pair.angle - before.angle) * progress; }
  return { ...to, params };
}
/** 固定圆体直接搬动，小圆体直接滚动；中心和累计角均取起拖状态。 */
export function dragRollingPair(start: PlanarState, target: string, point: Point, delta: Point, context?: { previous?: PlanarState }): PlanarState {
  const parsed = rollingTarget(target), pair = parsed && rollingPair(start, parsed.id), previous = context?.previous ?? start;
  if (!parsed || !pair || !finitePoint(point) || !finitePoint(delta)) return previous;
  const at = rollingFromStage(point, start), down = rollingFromStage({ x: point.x - delta.x, y: point.y - delta.y }, start);
  let next = pair;
  if (parsed.kind === "roll") {
    if (Math.hypot(at.x - pair.center.x, at.y - pair.center.y) < 1e-8 || Math.hypot(down.x - pair.center.x, down.y - pair.center.y) < 1e-8) return previous;
    const direction = (p: Point) => Math.atan2(p.y - pair.center.y, p.x - pair.center.x) * 180 / Math.PI;
    next = { ...pair, angle: unwrapAngle(pair.angle + direction(at) - direction(down), rollingPair(previous, pair.id)?.angle ?? pair.angle) };
  } else if (parsed.kind === "radius") next = { ...pair, R: Math.hypot(at.x - pair.center.x, at.y - pair.center.y) };
  else if (parsed.kind === "roller") {
    const radians = pair.angle * Math.PI / 180, along = (at.x - pair.center.x) * Math.cos(radians) + (at.y - pair.center.y) * Math.sin(radians);
    next = { ...pair, r: (along - pair.R) / (pair.inside ? -2 : 2) };
  } else next = { ...pair, center: { x: pair.center.x + delta.x / rollingScale(start), y: pair.center.y - delta.y / rollingScale(start) } };
  return checked(previous, writePair(start, next));
}
export function constructRollingPair(state: PlanarState, points: readonly Point[]): PlanarState | null {
  if (points.length !== 2 || points.some((point) => !finitePoint(point))) return null;
  const center = rollingFromStage(points[0], state), end = rollingFromStage(points[1], state), R = Math.hypot(end.x - center.x, end.y - center.y);
  const added = addRollingPair(state);
  if (added === state) return null;
  const candidate = fitRollingView(writePair(added, { id: added.params.active, center, R, r: R / 3, angle: 0, inside: false }));
  return isValidRollingWorkbenchState(candidate) ? candidate : null;
}

/** 轨迹仅为按实际参数采样的观察线；过密时不画可能混叠的伪折线。 */
export function rollingTracePoints(pair: RollingPair): { points: Point[]; tooDense: boolean } {
  const pose = rollingPose(pair), steps = Math.max(1, Math.ceil(Math.max(Math.abs(pair.angle), Math.abs(pose.rotation)) / 3));
  if (steps > 2048) return { points: [], tooDense: true };
  return { points: Array.from({ length: steps + 1 }, (_, i) => rollingPose({ ...pair, angle: pair.angle * i / steps }).marker), tooDense: false };
}
