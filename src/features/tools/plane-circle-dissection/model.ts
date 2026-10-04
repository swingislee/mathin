import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { CIRCLE_COUNTS, CIRCLE_DISSECTION_SCENE, isValidCircleDissectionState } from "./validation";

export const SECTOR_UNIT = 50;
export const SECTOR_ORIGIN = { x: 160, y: 530 };
export interface SectorPose extends Point { angle: number }
export const sectorToStage = (p: Point): Point => ({ x: SECTOR_ORIGIN.x + p.x * SECTOR_UNIT, y: SECTOR_ORIGIN.y - p.y * SECTOR_UNIT });
export const sectorFromStage = (p: Point): Point => ({ x: (p.x - SECTOR_ORIGIN.x) / SECTOR_UNIT, y: (SECTOR_ORIGIN.y - p.y) / SECTOR_UNIT });
const degrees = (point: Point) => Math.atan2(point.y, point.x) * 180 / Math.PI;
const angleDelta = (a: number, b: number) => ((b - a + 180) % 360 + 360) % 360 - 180;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const boundedTurn = (angle: number) => Math.abs(angle) <= 36000 ? angle : angle % 360;
const valid = (before: PlanarState, after: PlanarState) => isValidCircleDissectionState(after) ? after : before;
export function sectorTargetId(target: string | null) { const match = /^(?:sector|sector-turn)\.(0|[1-9]\d?)$/.exec(target ?? ""); return match ? Number(match[1]) : -1; }
export function sectorPose(state: PlanarState, id = state.params.active): SectorPose | null {
  const point = state.points[`sector.${id}`]; return point && Number.isInteger(id) && id >= 0 && id < state.params.count ? { ...point, angle: state.params[`turn.${id}`] } : null;
}
export function canonicalSectorPose(count: number, radius: number, id: number, layout: "circle" | "rows"): SectorPose {
  if (layout === "circle") return { x: 3.5, y: 2.5, angle: 360 * id / count };
  const half = count / 2, top = id >= half, edge = 2 * radius * Math.sin(Math.PI / count);
  return { x: 0.5 + id % half * edge + (top ? edge / 2 : 0), y: top ? 1.1 + radius * Math.cos(Math.PI / count) : 1.1, angle: (top ? 270 : 90) - 180 / count };
}
function writePose(state: PlanarState, id: number, pose: SectorPose): PlanarState {
  return { ...state, params: { ...state.params, [`turn.${id}`]: pose.angle }, points: { ...state.points, [`sector.${id}`]: { x: pose.x, y: pose.y } } };
}
function withPoses(state: PlanarState, count: number, pose: (id: number) => SectorPose): PlanarState {
  let next: PlanarState = { ...state, params: { count, radius: state.params.radius, active: state.params.active < 0 ? -1 : Math.min(count - 1, Math.floor(state.params.active * count / state.params.count)) }, points: {} };
  for (let id = 0; id < count; id++) next = writePose(next, id, pose(id));
  return valid(state, next);
}
export function createCircleDissectionState(): PlanarState {
  const state: PlanarState = { sceneId: CIRCLE_DISSECTION_SCENE, params: { count: 16, radius: 2.3, active: -1 }, points: {}, flags: { grid: false, measures: false, original: false, snap: true, names: false }, marks: [], phase: 0 };
  return withPoses(state, 16, (id) => canonicalSectorPose(16, 2.3, id, "circle"));
}
export function circleLayout(state: PlanarState): "circle" | "rows" | "custom" {
  for (const layout of ["circle", "rows"] as const) if (Array.from({ length: state.params.count }, (_, id) => id).every((id) => {
    const pose = sectorPose(state, id)!, goal = canonicalSectorPose(state.params.count, state.params.radius, id, layout);
    return distance(pose, goal) < 1e-8 && Math.abs(angleDelta(pose.angle, goal.angle)) < 1e-8;
  })) return layout;
  return "custom";
}
export function arrangeCircleSectors(state: PlanarState, layout: "circle" | "rows") {
  return withPoses(state, state.params.count, (id) => canonicalSectorPose(state.params.count, state.params.radius, id, layout));
}
/** 子片继承父片顶点及真实方向；自定义摆法细分时每个父区域的并集逐点不变。 */
function subdivide(state: PlanarState, count: number) {
  const ratio = count / state.params.count;
  return withPoses(state, count, (id) => {
    const parent = sectorPose(state, Math.floor(id / ratio))!;
    return { ...parent, angle: boundedTurn(parent.angle + id % ratio * 360 / count) };
  });
}
export function changeCircleCount(state: PlanarState, count: number): PlanarState {
  if (!(CIRCLE_COUNTS as readonly number[]).includes(count) || count === state.params.count) return state;
  const layout = circleLayout(state);
  if (layout !== "custom") return withPoses(state, count, (id) => canonicalSectorPose(count, state.params.radius, id, layout));
  if (count > state.params.count) return subdivide(state, count);
  const ratio = state.params.count / count;
  for (let id = 0; id < count; id++) {
    const first = sectorPose(state, id * ratio)!;
    for (let child = 1; child < ratio; child++) {
      const next = sectorPose(state, id * ratio + child)!;
      if (distance(first, next) > 1e-8 || Math.abs(angleDelta(first.angle + child * 360 / state.params.count, next.angle)) > 1e-8) return state;
    }
  }
  return withPoses(state, count, (id) => sectorPose(state, id * ratio)!);
}
export function selectSector(state: PlanarState, target: string) { const id = sectorTargetId(target); return sectorPose(state, id) ? { ...state, params: { ...state.params, active: id } } : state; }
export function setCircleSectorField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  if (key === "radius") {
    const layout = circleLayout(state), next: PlanarState = { ...state, params: { ...state.params, radius: value } };
    return valid(state, layout === "custom" ? next : withPoses(next, next.params.count, (id) => canonicalSectorPose(next.params.count, value, id, layout)));
  }
  if (key === "active") return Number.isInteger(value) && sectorPose(state, value - 1) ? { ...state, params: { ...state.params, active: value - 1 } } : state;
  const pose = sectorPose(state); if (!pose) return state;
  if (key === "x" || key === "y" || key === "angle") return valid(state, writePose(state, state.params.active, { ...pose, [key]: value }));
  return state;
}
export function dragCircleSector(start: PlanarState, target: string, point: Point, delta: Point, context?: { previous?: PlanarState }): PlanarState {
  const selected = selectSector(start, target), id = sectorTargetId(target), pose = sectorPose(start, id); if (!pose) return start;
  if (!target.startsWith("sector-turn.")) return valid(start, writePose(selected, id, { ...pose, x: pose.x + delta.x / SECTOR_UNIT, y: pose.y - delta.y / SECTOR_UNIT }));
  const at = sectorFromStage(point), grip = sectorFromStage({ x: point.x - delta.x, y: point.y - delta.y });
  if (distance(at, pose) < 1e-6 || distance(grip, pose) < 1e-6) return context?.previous ?? start;
  const candidate = pose.angle + degrees({ x: at.x - pose.x, y: at.y - pose.y }) - degrees({ x: grip.x - pose.x, y: grip.y - pose.y });
  const previous = sectorPose(context?.previous ?? start, id)!.angle;
  return valid(start, writePose(selected, id, { ...pose, angle: candidate + 360 * Math.round((previous - candidate) / 360) }));
}
export function snapCircleSector(state: PlanarState, target: string) {
  const id = sectorTargetId(target), pose = sectorPose(state, id); if (!state.flags.snap || !pose) return null;
  const goals = ["circle", "rows"].map((layout) => canonicalSectorPose(state.params.count, state.params.radius, id, layout as "circle" | "rows"));
  const goal = goals.filter((candidate) => Math.abs(angleDelta(pose.angle, candidate.angle)) < 4).sort((a, b) => distance(pose, a) - distance(pose, b))[0];
  return goal && distance(pose, goal) < 0.25 ? writePose(state, id, { ...goal, angle: boundedTurn(pose.angle + angleDelta(pose.angle, goal.angle)) }) : null;
}
export function interpolateCircleSectors(from: PlanarState, to: PlanarState, progress: number): PlanarState {
  if (progress <= 0) return from; if (progress >= 1) return to;
  const start = to.params.count > from.params.count ? subdivide(from, to.params.count) : from;
  return withPoses(to, to.params.count, (id) => {
    const a = sectorPose(start, id)!, b = sectorPose(to, id)!, fraction = Math.max(0, Math.min(1, progress * 1.4 - id / Math.max(1, to.params.count - 1) * 0.4));
    return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, angle: boundedTurn(a.angle + angleDelta(a.angle, b.angle) * fraction) };
  });
}
export function sectorPoint(pose: SectorPose, radius: number, relativeAngle: number): Point {
  const angle = (pose.angle + relativeAngle) * Math.PI / 180; return { x: pose.x + radius * Math.cos(angle), y: pose.y + radius * Math.sin(angle) };
}
