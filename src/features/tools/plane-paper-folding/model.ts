import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { constructionArea, isSimpleConstructionPolygon } from "../plane-construction/model";
import { dragFoldProgress, foldPoint, reflectedPoint } from "../plane-motion/model";

export const PAPER_FOLDING_SCENE = "32-create";
export const MAX_PAPER_VERTICES = 32;
export const MAX_PAPER_CUTS = 12;
export const MAX_CUT_POINTS = 192;
const EPS = 1e-7;
export interface PaperCut { kind: "circle" | "polygon"; points: PlanarPoint[]; radius: number }
export const clampPhase = (value: number) => Math.max(0, Math.min(1, value));
const cross = (a: PlanarPoint, b: PlanarPoint, c: PlanarPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const signedArea = (points: readonly PlanarPoint[]) => points.reduce((sum, point, i) => { const next = points[(i + 1) % points.length]; return sum + point.x * next.y - next.x * point.y; }, 0) / 2;
const distance = (a: PlanarPoint, b: PlanarPoint) => Math.hypot(a.x - b.x, a.y - b.y);
export const stagePoint = (point: PlanarPoint) => !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 960 && point.y >= 0 && point.y <= 720;
export function paperVertices(state: PlanarState): PlanarPoint[] { return Array.from({ length: state.params.paperCount }, (_, i) => state.points[`paper.${i}`]); }
export function paperCuts(state: PlanarState): PaperCut[] {
  return Array.from({ length: state.params.cutCount }, (_, i) => ({ kind: state.params[`cutKind.${i}`] === 0 ? "circle" : "polygon", radius: state.params[`cutRadius.${i}`], points: Array.from({ length: state.params[`cutVertices.${i}`] }, (_, j) => state.points[`cut.${i}.${j}`]) }));
}
export function paperAxis(state: PlanarState) {
  const a = state.points.creaseA, b = state.points.creaseB;
  return { point: a, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
}
/** SVG 中的 A→B 左侧为正；这个方向也用于“折起哪一侧”的参数。 */
export function creaseDistance(point: PlanarPoint, a: PlanarPoint, b: PlanarPoint): number {
  const length = distance(a, b);
  return length > EPS ? ((point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x)) / length : 0;
}
export function clipHalfPlane(points: readonly PlanarPoint[], a: PlanarPoint, b: PlanarPoint, side: number): PlanarPoint[] {
  const output: PlanarPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const current = points[i], next = points[(i + 1) % points.length], d0 = creaseDistance(current, a, b) * side, d1 = creaseDistance(next, a, b) * side;
    if (d0 >= -EPS) output.push(current);
    if (d0 > EPS && d1 < -EPS || d0 < -EPS && d1 > EPS) {
      const t = d0 / (d0 - d1); output.push({ x: current.x + (next.x - current.x) * t, y: current.y + (next.y - current.y) * t });
    }
  }
  return output.filter((point, i) => !i || distance(point, output[i - 1]) > EPS);
}
/** 简单凹多边形先作耳切，半平面裁剪后允许同一侧形成多个真实纸片区域。 */
export function triangulatePaper(input: readonly PlanarPoint[]): PlanarPoint[][] {
  let points = input.map((point) => ({ ...point }));
  points = points.filter((point, i) => Math.abs(cross(points[(i + points.length - 1) % points.length], point, points[(i + 1) % points.length])) > EPS);
  if (points.length < 3) return [];
  const orientation = Math.sign(signedArea(points)), triangles: PlanarPoint[][] = [];
  for (let guard = 0; points.length > 3 && guard < 1024; guard++) {
    let clipped = false;
    for (let i = 0; i < points.length; i++) {
      const before = (i + points.length - 1) % points.length, after = (i + 1) % points.length, a = points[before], b = points[i], c = points[after];
      if (cross(a, b, c) * orientation <= EPS) continue;
      if (points.some((point, j) => j !== before && j !== i && j !== after && cross(a, b, point) * orientation >= -EPS && cross(b, c, point) * orientation >= -EPS && cross(c, a, point) * orientation >= -EPS)) continue;
      triangles.push([a, b, c]); points.splice(i, 1); clipped = true; break;
    }
    if (!clipped) return [];
  }
  if (points.length === 3) triangles.push(points);
  return triangles;
}
export function paperRegions(state: PlanarState, moving: boolean, phase = state.phase): PlanarPoint[][] {
  if (!state.params.creaseSet) return moving ? [] : triangulatePaper(paperVertices(state));
  const side = moving ? state.params.side : -state.params.side;
  return triangulatePaper(paperVertices(state)).map((triangle) => clipHalfPlane(triangle, state.points.creaseA, state.points.creaseB, side))
    .filter((polygon) => polygon.length >= 3 && constructionArea(polygon) > EPS)
    .map((polygon) => moving ? polygon.map((point) => foldPoint(point, paperAxis(state), phase)) : polygon);
}
export function creaseSplitsPaper(state: PlanarState): boolean {
  return distance(state.points.creaseA, state.points.creaseB) >= 12 && [false, true].every((moving) => paperRegions({ ...state, params: { ...state.params, creaseSet: 1 } }, moving, 0).reduce((sum, polygon) => sum + constructionArea(polygon), 0) > 1);
}
function insideConvex(point: PlanarPoint, polygon: readonly PlanarPoint[]): boolean {
  const sign = Math.sign(signedArea(polygon));
  return polygon.every((a, i) => cross(a, polygon[(i + 1) % polygon.length], point) * sign >= -EPS);
}
function segmentDistance(point: PlanarPoint, a: PlanarPoint, b: PlanarPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
  return distance(point, { x: a.x + dx * t, y: a.y + dy * t });
}
function convexIntersection(a: readonly PlanarPoint[], b: readonly PlanarPoint[]): PlanarPoint[] {
  let result = [...a]; const side = -Math.sign(signedArea(b));
  for (let i = 0; i < b.length && result.length; i++) result = clipHalfPlane(result, b[i], b[(i + 1) % b.length], side);
  return result;
}
export function cutIntersectsPaper(state: PlanarState, cut: PaperCut): boolean {
  const regions = [...paperRegions(state, false, 1), ...paperRegions(state, true, 1)];
  if (cut.kind === "circle") return regions.some((polygon) => insideConvex(cut.points[0], polygon) || polygon.some((a, i) => segmentDistance(cut.points[0], a, polygon[(i + 1) % polygon.length]) < cut.radius - EPS));
  const triangles = triangulatePaper(cut.points);
  return regions.some((polygon) => triangles.some((triangle) => constructionArea(convexIntersection(polygon, triangle)) > EPS));
}
export function sourceCut(state: PlanarState, cut: PaperCut, moving: boolean): PaperCut {
  return moving ? { ...cut, points: cut.points.map((point) => reflectedPoint(point, paperAxis(state))) } : cut;
}
export function paperPointRemains(state: PlanarState, original: PlanarPoint): boolean {
  if (!triangulatePaper(paperVertices(state)).some((triangle) => insideConvex(original, triangle))) return false;
  const moving = state.params.creaseSet && creaseDistance(original, state.points.creaseA, state.points.creaseB) * state.params.side > EPS;
  const at = moving ? reflectedPoint(original, paperAxis(state)) : original;
  return !paperCuts(state).some((cut) => cut.kind === "circle" ? distance(at, cut.points[0]) < cut.radius - EPS : triangulatePaper(cut.points).some((triangle) => insideConvex(at, triangle)));
}
export function createPaperFoldingState(): PlanarState {
  return { sceneId: PAPER_FOLDING_SCENE, params: { paperCount: 4, creaseSet: 0, side: 1, cutCount: 0 },
    points: { "paper.0": { x: 260, y: 180 }, "paper.1": { x: 700, y: 180 }, "paper.2": { x: 700, y: 560 }, "paper.3": { x: 260, y: 560 }, creaseA: { x: 300, y: 370 }, creaseB: { x: 660, y: 370 } },
    flags: { grid: false, measures: false, crease: true, edit: false }, marks: [], phase: 0 };
}
export function canChangePaper(state: PlanarState) { return state.phase === 0 && state.params.cutCount === 0; }
export function clearPaperCuts(state: PlanarState): PlanarState {
  const params: Record<string, number> = { ...state.params, cutCount: 0 }, points = { ...state.points };
  Object.keys(params).filter((key) => /^cut(?:Kind|Vertices|Radius)\./.test(key)).forEach((key) => { delete params[key]; });
  Object.keys(points).filter((key) => key.startsWith("cut.")).forEach((key) => { delete points[key]; });
  return { ...state, params, points };
}
function normalizePolygon(points: readonly PlanarPoint[]): PlanarPoint[] {
  return points.length > 3 && distance(points[0], points[points.length - 1]) < EPS ? points.slice(0, -1) : [...points];
}
export function constructPaper(state: PlanarState, tool: string, input: readonly PlanarPoint[]): PlanarState | null {
  if (!input.every(stagePoint)) return null;
  if (tool === "paper-rectangle" || tool === "paper-polygon") {
    if (!canChangePaper(state)) return null;
    let vertices = normalizePolygon(input);
    if (tool === "paper-rectangle") {
      if (input.length !== 2) return null;
      const [a, b] = input; vertices = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
    }
    if (!isSimpleConstructionPolygon(vertices)) return null;
    const points = { creaseA: state.points.creaseA, creaseB: state.points.creaseB } as Record<string, PlanarPoint>;
    vertices.forEach((point, i) => { points[`paper.${i}`] = point; });
    return { ...state, params: { paperCount: vertices.length, creaseSet: 0, side: state.params.side, cutCount: 0 }, points, marks: [], phase: 0 };
  }
  if (tool === "crease") {
    if (!canChangePaper(state) || input.length !== 2) return null;
    const next = { ...state, params: { ...state.params, creaseSet: 1 }, points: { ...state.points, creaseA: input[0], creaseB: input[1] } };
    return creaseSplitsPaper(next) ? next : null;
  }
  if (state.phase !== 1 || !state.params.creaseSet || state.params.cutCount >= MAX_PAPER_CUTS) return null;
  let cut: PaperCut;
  if (tool === "cut-circle") {
    if (input.length !== 2) return null;
    const radius = distance(input[0], input[1]);
    if (radius < 3 || radius > 350) return null;
    cut = { kind: "circle", points: [input[0]], radius };
  } else if (tool === "cut-polygon") {
    const points = normalizePolygon(input);
    if (!isSimpleConstructionPolygon(points)) return null;
    cut = { kind: "polygon", points, radius: 0 };
  } else return null;
  const oldCuts = paperCuts(state);
  if (oldCuts.reduce((sum, item) => sum + item.points.length, cut.points.length) > MAX_CUT_POINTS || !cutIntersectsPaper(state, cut) || oldCuts.some((item) => JSON.stringify(item) === JSON.stringify(cut))) return null;
  const id = state.params.cutCount, points = { ...state.points };
  cut.points.forEach((point, i) => { points[`cut.${id}.${i}`] = point; });
  return { ...state, params: { ...state.params, cutCount: id + 1, [`cutKind.${id}`]: cut.kind === "circle" ? 0 : 1, [`cutVertices.${id}`]: cut.points.length, [`cutRadius.${id}`]: cut.radius }, points };
}
export function setPaperField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  if (key === "foldAngle") return state.params.creaseSet ? { ...state, phase: clampPhase(value / 180) } : state;
  if (!canChangePaper(state)) return state;
  if (key === "side") return value === 1 || value === -1 ? { ...state, params: { ...state.params, side: value } } : state;
  if (!state.params.creaseSet) return state;
  const a = state.points.creaseA, b = state.points.creaseB, center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, half = distance(a, b) / 2;
  let next = state;
  if (key === "axisX" || key === "axisY") {
    const delta = { x: key === "axisX" ? value - center.x : 0, y: key === "axisY" ? value - center.y : 0 };
    next = { ...state, points: { ...state.points, creaseA: { x: a.x + delta.x, y: a.y + delta.y }, creaseB: { x: b.x + delta.x, y: b.y + delta.y } } };
  } else if (key === "axisAngle") {
    const angle = value * Math.PI / 180, dx = half * Math.cos(angle), dy = half * Math.sin(angle);
    next = { ...state, points: { ...state.points, creaseA: { x: center.x - dx, y: center.y - dy }, creaseB: { x: center.x + dx, y: center.y + dy } } };
  }
  return creaseSplitsPaper(next) && [next.points.creaseA, next.points.creaseB].every((point) => point.x >= -960 && point.x <= 1920 && point.y >= -720 && point.y <= 1440) ? next : state;
}
export function dragPaper(state: PlanarState, target: string, point: PlanarPoint, delta: PlanarPoint): PlanarState {
  if (target === "paper-moving" && state.params.creaseSet) {
    const a = state.points.creaseA, b = state.points.creaseB, length = distance(a, b), normal = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
    return { ...state, phase: dragFoldProgress(state.phase, delta, paperAxis(state), { x: a.x + normal.x * state.params.side, y: a.y + normal.y * state.params.side }) };
  }
  if (!canChangePaper(state)) return state;
  if (target === "crease" || target === "creaseA" || target === "creaseB") {
    const points = { ...state.points };
    for (const key of ["creaseA", "creaseB"] as const) if (target === "crease" || target === key) points[key] = { x: points[key].x + delta.x, y: points[key].y + delta.y };
    const next = { ...state, points };
    return [points.creaseA, points.creaseB].every((item) => item.x >= -960 && item.x <= 1920 && item.y >= -720 && item.y <= 1440) && creaseSplitsPaper(next) ? next : state;
  }
  const vertex = /^paper\.(\d+)$/.exec(target);
  if (!state.flags.edit || !vertex || Number(vertex[1]) >= state.params.paperCount) return state;
  const at = state.points[target], moved = { x: at.x + delta.x, y: at.y + delta.y };
  if (!stagePoint(moved)) return state;
  const next = { ...state, points: { ...state.points, [target]: moved } };
  return isSimpleConstructionPolygon(paperVertices(next)) && (!state.params.creaseSet || creaseSplitsPaper(next)) ? next : state;
}
export function paperFoldMatrix(state: PlanarState): [number, number, number, number, number, number] {
  const a = state.points.creaseA, b = state.points.creaseB, length = distance(a, b), ux = (b.x - a.x) / length, uy = (b.y - a.y) / length, c = Math.cos(Math.PI * state.phase);
  const xx = ux * ux + c * uy * uy, xy = (1 - c) * ux * uy, yy = uy * uy + c * ux * ux;
  return [xx, xy, xy, yy, a.x - xx * a.x - xy * a.y, a.y - xy * a.x - yy * a.y];
}
