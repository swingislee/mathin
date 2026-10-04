import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { constructionArea } from "../plane-construction/model";
import { clipHalfPlane, triangulatePaper } from "../plane-paper-folding/model";

export const EPS = 1e-7;
export type Matrix = [number, number, number, number, number, number];
export const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
export interface PaperLayer { bits: number; sourceRegions: PlanarPoint[][]; maps: Matrix[] }
export interface LayerCut { id: number; kind: "circle" | "polygon"; depth: number; points: PlanarPoint[]; radius: number }
export const distance = (a: PlanarPoint, b: PlanarPoint) => Math.hypot(a.x - b.x, a.y - b.y);
export const paperVertices = (state: PlanarState): PlanarPoint[] => Array.from({ length: state.params.paperCount }, (_, i) => state.points[`paper.${i}`]);
export function paperCuts(state: PlanarState): LayerCut[] {
  return Object.keys(state.params).flatMap((key) => /^cutKind\.(0|[1-9]\d{0,4})$/.test(key) ? [Number(key.slice(8))] : []).sort((a, b) => a - b).map((id) => ({
    id, kind: state.params[`cutKind.${id}`] === 0 ? "circle" : "polygon", depth: state.params[`cutDepth.${id}`], radius: state.params[`cutRadius.${id}`],
    points: Array.from({ length: state.params[`cutVertices.${id}`] }, (_, j) => state.points[`cut.${id}.${j}`]),
  }));
}
export const applyMatrix = (m: Matrix, p: PlanarPoint): PlanarPoint => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
/** 矩阵从原纸坐标向当前纸层坐标组合；纸层始终保留原纸区域。 */
export function compose(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
export function inverse(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
export function hingeMatrix(state: PlanarState, i: number, angle = state.params[`foldAngle.${i}`]): Matrix {
  const a = state.points[`foldA.${i}`], b = state.points[`foldB.${i}`], length = distance(a, b), ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
  const cos = angle === 0 ? 1 : angle === 180 ? -1 : Math.cos(angle * Math.PI / 180), xx = ux * ux + cos * uy * uy, xy = (1 - cos) * ux * uy, yy = uy * uy + cos * ux * ux;
  return [xx, xy, xy, yy, a.x - xx * a.x - xy * a.y, a.y - xy * a.x - yy * a.y];
}
export function layerMatrix(state: PlanarState, layer: PaperLayer): Matrix {
  let matrix = identity();
  for (let i = 0; i < state.params.foldCount; i++) if (layer.bits & (1 << i)) matrix = compose(hingeMatrix(state, i), matrix);
  return matrix;
}
/** 每次先裁开真实纸层，再反射折起部分并反转其层序。最多四条来源路径，不复制整张纸。 */
export function buildPaperLayers(state: PlanarState): { layers: PaperLayer[]; splitAreas: [number, number][] } {
  let layers: PaperLayer[] = [{ bits: 0, sourceRegions: triangulatePaper(paperVertices(state)), maps: [identity()] }];
  const splitAreas: [number, number][] = [];
  for (let i = 0; i < state.params.foldCount; i++) {
    const fixed: PaperLayer[] = [], moving: PaperLayer[] = [], areas: [number, number] = [0, 0], a = state.points[`foldA.${i}`], b = state.points[`foldB.${i}`], reflected = hingeMatrix(state, i, 180);
    for (const layer of layers) for (const side of [0, 1]) {
      const map = layer.maps[i], back = inverse(map), regions = layer.sourceRegions.map((polygon) => clipHalfPlane(polygon.map((p) => applyMatrix(map, p)), a, b, state.params[`foldSide.${i}`] * (side ? 1 : -1))).filter((poly) => poly.length >= 3 && constructionArea(poly) > EPS);
      areas[side] += regions.reduce((sum, polygon) => sum + constructionArea(polygon), 0);
      if (regions.length) (side ? moving : fixed).push({ bits: layer.bits | (side << i), sourceRegions: regions.map((polygon) => polygon.map((p) => applyMatrix(back, p))), maps: [...layer.maps, side ? compose(reflected, map) : map] });
    }
    splitAreas.push(areas); layers = [...fixed, ...moving.reverse()];
  }
  return { layers, splitAreas };
}
export function orderedPaperLayers(state: PlanarState): PaperLayer[] {
  let layers = buildPaperLayers(state).layers.sort((a, b) => a.bits - b.bits);
  for (let i = 0; i < state.params.foldCount; i++) if (state.params[`foldAngle.${i}`] > 0) {
    const moving = layers.filter((layer) => layer.bits & (1 << i));
    layers = [...layers.filter((layer) => !(layer.bits & (1 << i))), ...(state.params[`foldAngle.${i}`] > 90 ? moving.reverse() : moving)];
  }
  return layers;
}
const signedArea = (poly: readonly PlanarPoint[]) => poly.reduce((sum, p, i) => { const q = poly[(i + 1) % poly.length]; return sum + p.x * q.y - q.x * p.y; }, 0) / 2;
const cross = (a: PlanarPoint, b: PlanarPoint, p: PlanarPoint) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
export function insideConvex(point: PlanarPoint, polygon: readonly PlanarPoint[]): boolean {
  const sign = Math.sign(signedArea(polygon));
  return polygon.length >= 3 && polygon.every((a, i) => cross(a, polygon[(i + 1) % polygon.length], point) * sign >= -EPS);
}
function segmentDistance(point: PlanarPoint, a: PlanarPoint, b: PlanarPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy, t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
  return distance(point, { x: a.x + dx * t, y: a.y + dy * t });
}
export function cutIntersectsRegions(cut: LayerCut, regions: readonly PlanarPoint[][]): boolean {
  if (cut.kind === "circle") return regions.some((poly) => insideConvex(cut.points[0], poly) || poly.some((p, i) => segmentDistance(cut.points[0], p, poly[(i + 1) % poly.length]) < cut.radius - EPS));
  const triangles = triangulatePaper(cut.points);
  return regions.some((poly) => triangles.some((triangle) => {
    let result = [...poly]; const side = -Math.sign(signedArea(triangle));
    for (let i = 0; i < 3 && result.length; i++) result = clipHalfPlane(result, triangle[i], triangle[(i + 1) % 3], side);
    return constructionArea(result) > EPS;
  }));
}
export function cutIntersectsLayers(cut: LayerCut, layers: readonly PaperLayer[]): boolean {
  return layers.some((layer) => cutIntersectsRegions(cut, layer.sourceRegions.map((poly) => poly.map((p) => applyMatrix(layer.maps[cut.depth], p)))));
}
export const sourceCut = (cut: LayerCut, layer: PaperLayer): LayerCut => ({ ...cut, points: cut.points.map((p) => applyMatrix(inverse(layer.maps[cut.depth]), p)) });
export function paperPointRemains(state: PlanarState, original: PlanarPoint): boolean {
  const cuts = paperCuts(state);
  return buildPaperLayers(state).layers.some((layer) => layer.sourceRegions.some((poly) => insideConvex(original, poly)) && !cuts.some((cut) => {
    const at = applyMatrix(layer.maps[cut.depth], original);
    return cut.kind === "circle" ? distance(at, cut.points[0]) < cut.radius - EPS : triangulatePaper(cut.points).some((triangle) => insideConvex(at, triangle));
  }));
}
