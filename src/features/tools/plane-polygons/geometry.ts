import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";

export const POLYGON_SCENE = "06-create", POLYGON_UNIT = 40, POLYGON_LIMIT = 16;
export const POLYGON_BOUND = 4000, LOCAL_BOUND = 2400, DIMENSION_MIN = 4, DIMENSION_MAX = 1600;
export type PolygonKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type Dimension = "width" | "left" | "right" | "height" | "shift" | "top" | "opening" | "side";
/** 小棒、三棒、活动框架、自由三角形/四边形、矩形、正方形、平行四边形、菱形、梯形。 */
export const POLYGON_DIMENSIONS: readonly (readonly Dimension[])[] = [
  ["width"], ["width", "left", "right", "side"], ["width", "left", "opening", "side"], [], [],
  ["width", "height"], ["width"], ["width", "height", "shift"], ["width", "opening"], ["width", "top", "height", "shift"],
];
export interface PolygonCorner { at: Point; turn: number }
export interface PolygonMaterial {
  id: number; kind: PolygonKind; origin: Point; rotation: number; base: number;
  dimensions: Partial<Record<Dimension, number>>; vertices: Point[]; height: boolean; corners: PolygonCorner[] | null;
}
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (p: Point, factor: number): Point => ({ x: p.x * factor, y: p.y * factor });
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
export const direction = (p: Point) => Math.atan2(p.y, p.x) * 180 / Math.PI;
export const normalizeTurn = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;
export const polar = (radius: number, degrees: number): Point => ({ x: radius * Math.cos(degrees * Math.PI / 180), y: radius * Math.sin(degrees * Math.PI / 180) });
export const rotate = (p: Point, degrees: number): Point => {
  const u = polar(1, degrees); return { x: p.x * u.x - p.y * u.y, y: p.x * u.y + p.y * u.x };
};
export const signedArea = (points: readonly Point[]) => points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0) / 2;
export const toWorld = (object: PolygonMaterial, point: Point) => add(object.origin, rotate(point, object.rotation));
export const toLocal = (object: PolygonMaterial, point: Point) => rotate(subtract(point, object.origin), -object.rotation);
export const polygonVertexCount = (kind: PolygonKind) => kind === 0 ? 2 : kind === 1 || kind === 3 ? 3 : 4;

/** 三棒不等式失败时展示最小真实间隙；等号表示共线，而不是有面积的三角形。 */
export function polygonThreeRods(width: number, left: number, right: number, side = 1) {
  const a = { x: 0, y: 0 }, b = { x: width, y: 0 };
  const closed = width < left + right && left < width + right && right < width + left;
  if (closed) {
    const x = (left * left + (width - right) * (width + right)) / (2 * width);
    const y = -side * Math.sqrt((width + left + right) * (left + right - width) * (width + right - left) * (width + left - right)) / (2 * width);
    const c = { x, y };
    return { points: [a, b, c, c], segments: [[a, b], [a, c], [b, c]], closed, gap: 0 };
  }
  const c = { x: left >= width + right || width >= left + right ? left : -left, y: 0 };
  const d = { x: width + (left >= width + right ? right : -right), y: 0 };
  return { points: [a, b, c, d], segments: [[a, b], [a, c], [b, d]], closed, gap: distance(c, d) };
}

export function polygonLocalVertices(object: PolygonMaterial): Point[] {
  const d = object.dimensions, width = d.width ?? 0;
  if (object.kind === 0) return [{ x: 0, y: 0 }, { x: width, y: 0 }];
  if (object.kind === 1) return polygonThreeRods(width, d.left!, d.right!, d.side!).points;
  if (object.kind === 3 || object.kind === 4) return object.vertices;
  let shift = d.shift ?? 0, height = d.height ?? width, top = d.top ?? width;
  if (object.kind === 2 || object.kind === 8) {
    const side = polar(object.kind === 8 ? width : d.left!, -d.opening! * (d.side ?? 1));
    shift = side.x; height = -side.y;
  }
  if (object.kind !== 9) top = width;
  return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: shift + top, y: -height }, { x: shift, y: -height }];
}
export const polygonWorldVertices = (object: PolygonMaterial) => polygonLocalVertices(object).map((point) => toWorld(object, point));
export function polygonMaterial(state: PlanarState, id = state.params.active): PolygonMaterial | null {
  if (!Number.isInteger(id) || id < 0 || id >= state.params.count) return null;
  const kind = state.params[`kind.${id}`] as PolygonKind;
  return { id, kind, origin: state.points[`origin.${id}`], rotation: state.params[`rotation.${id}`], base: state.params[`base.${id}`],
    dimensions: Object.fromEntries((POLYGON_DIMENSIONS[kind] ?? []).map((key) => [key, state.params[`${key}.${id}`]])),
    vertices: kind === 3 || kind === 4 ? Array.from({ length: polygonVertexCount(kind) }, (_, i) => state.points[`vertex.${id}.${i}`]) : [],
    height: state.flags[`height.${id}`], corners: state.flags[`angles.${id}`]
      ? Array.from({ length: 3 }, (_, i) => ({ at: state.points[`corner.${id}.${i}`], turn: state.params[`turn.${id}.${i}`] })) : null };
}
export const polygonMaterials = (state: PlanarState) => Array.from({ length: state.params.count }, (_, id) => polygonMaterial(state, id)!);

/** 仅用于三角形/四边形的小规模精确拓扑；允许凹四边形，拒绝交叉和共线假顶点。 */
export function isSimpleWorkbenchPolygon(points: readonly Point[]): boolean {
  if (![3, 4].includes(points.length) || Math.abs(signedArea(points)) < 1 - 1e-8) return false;
  const orientation = (a: Point, b: Point, c: Point) => cross(subtract(b, a), subtract(c, a));
  for (let i = 0; i < points.length; i++) {
    if (distance(points[i], points[(i + 1) % points.length]) < DIMENSION_MIN - 1e-8
      || Math.abs(orientation(points[i], points[(i + 1) % points.length], points[(i + 2) % points.length])) < 1e-8) return false;
  }
  if (points.length === 3) return true;
  const intersects = (a: Point, b: Point, c: Point, d: Point) => {
    const values = [orientation(a, b, c), orientation(a, b, d), orientation(c, d, a), orientation(c, d, b)];
    const on = (p: Point, u: Point, v: Point, area: number) => Math.abs(area) <= 1e-8
      && p.x >= Math.min(u.x, v.x) - 1e-8 && p.x <= Math.max(u.x, v.x) + 1e-8
      && p.y >= Math.min(u.y, v.y) - 1e-8 && p.y <= Math.max(u.y, v.y) + 1e-8;
    return values[0] * values[1] < 0 && values[2] * values[3] < 0
      || on(c, a, b, values[0]) || on(d, a, b, values[1]) || on(a, c, d, values[2]) || on(b, c, d, values[3]);
  };
  return !intersects(points[0], points[1], points[2], points[3]) && !intersects(points[1], points[2], points[3], points[0]);
}

export function polygonCornerGeometry(object: PolygonMaterial) {
  const points = polygonLocalVertices(object);
  if (object.kind !== 3) return [];
  const sideLengths = points.map((p, i) => distance(p, points[(i + 1) % 3]));
  // 圆弧角片完全位于原三角形内；刚体搬运时半径、两边夹角均保持。
  const radius = Math.min(52, Math.min(...sideLengths) * .24, Math.abs(signedArea(points)) * 2 / Math.max(...sideLengths) * .4);
  return points.map((at, i) => {
    const next = subtract(points[(i + 1) % 3], at), previous = subtract(points[(i + 2) % 3], at);
    return { at, turn: direction(next), sweep: Math.atan2(cross(next, previous), dot(next, previous)) * 180 / Math.PI, radius };
  });
}
export function polygonJoinedCorners(object: PolygonMaterial): PolygonCorner[] {
  const points = polygonLocalVertices(object), geometry = polygonCornerGeometry(object);
  const at = { x: (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2, y: Math.max(...points.map((p) => p.y)) + 115 };
  let accumulated = 0;
  return geometry.map((corner) => {
    const turn = normalizeTurn(corner.sweep < 0 ? 360 - accumulated : 180 + accumulated);
    accumulated += Math.abs(corner.sweep); return { at: { ...at }, turn };
  });
}
