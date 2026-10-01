import type { PlanarPoint as Point } from "../planar-kit/contract";
import { constructionArea, isSimpleConstructionPolygon } from "../plane-construction/model";

export const REGION_EPS = 1e-7;
export const crossAt = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export const between = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const signedRegionArea = (points: readonly Point[]) => points.reduce((sum, a, i) => {
  const b = points[(i + 1) % points.length]; return sum + a.x * b.y - b.x * a.y;
}, 0) / 2;

/** 首批布尔运算只接收凸直边材料；同向共线的编辑点不改变数学边界。 */
export function isConvexMaterial(points: readonly Point[], strict = false): boolean {
  if (!isSimpleConstructionPolygon(points)) return false;
  const orientation = Math.sign(signedRegionArea(points));
  return points.every((a, i) => {
    const turn = orientation * crossAt(a, points[(i + 1) % points.length], points[(i + 2) % points.length]);
    return strict ? turn > REGION_EPS : turn >= -REGION_EPS;
  });
}

function cleanRegion(points: readonly Point[]): Point[] {
  const result = points.filter((point, i) => i === 0 || Math.hypot(point.x - points[i - 1].x, point.y - points[i - 1].y) > REGION_EPS);
  if (result.length > 1 && Math.hypot(result[0].x - result[result.length - 1].x, result[0].y - result[result.length - 1].y) <= REGION_EPS) result.pop();
  return result.length >= 3 && constructionArea(result) > REGION_EPS ? result : [];
}

/** 裁切凸区域到有向直线一侧。交点来自线段参数，不从包围盒或显示像素估算。 */
export function clipRegion(points: readonly Point[], a: Point, b: Point, side: number): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const current = points[i], previous = points[(i + points.length - 1) % points.length];
    const currentDistance = side * crossAt(a, b, current), previousDistance = side * crossAt(a, b, previous);
    const inside = currentDistance >= -REGION_EPS, previousInside = previousDistance >= -REGION_EPS;
    if (inside !== previousInside) {
      const denominator = previousDistance - currentDistance;
      if (Math.abs(denominator) > REGION_EPS) result.push(between(previous, current, previousDistance / denominator));
    }
    if (inside) result.push(current);
  }
  return cleanRegion(result);
}

export interface ConvexRegions { intersection: Point[]; difference: Point[][]; union: Point[][] }

/** A−B 按 B 的半平面逐步剥离，返回互不重叠的凸片；包含时的孔保留为空白。 */
export function convexRegions(a: readonly Point[], b: readonly Point[]): ConvexRegions {
  let remaining = cleanRegion(a);
  const difference: Point[][] = [], orientation = Math.sign(signedRegionArea(b));
  if (b.length < 3 || orientation === 0) return { intersection: [], difference: remaining.length ? [remaining] : [], union: remaining.length ? [remaining] : [] };
  for (let i = 0; i < b.length && remaining.length; i++) {
    const first = b[i], second = b[(i + 1) % b.length];
    const outside = clipRegion(remaining, first, second, -orientation);
    if (outside.length) difference.push(outside);
    remaining = clipRegion(remaining, first, second, orientation);
  }
  const wholeB = cleanRegion(b);
  return { intersection: remaining, difference, union: [...difference, ...(wholeB.length ? [wholeB] : [])] };
}

export const regionsArea = (regions: readonly Point[][]) => regions.reduce((sum, polygon) => sum + constructionArea(polygon), 0);
export const regionPath = (regions: readonly Point[][]) => regions.map((polygon) => `M ${polygon.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`).join(" ");
