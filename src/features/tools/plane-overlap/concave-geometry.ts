import type { PlanarPoint as Point } from "../planar-kit/contract";

export interface ConcaveRegions { intersection: Point[][]; difference: Point[][]; union: Point[][] }
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const length = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** 距离容差只吸收 IEEE 浮点舍入，单位与坐标相同；没有像素、网格或固定面积截断。 */
const roundoff = (...points: Point[]) => 8 * Number.EPSILON * Math.max(1, ...points.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]));
function lineDistance(a: Point, b: Point, point: Point) {
  const distance = cross(a, b, point) / length(a, b);
  return Math.abs(distance) <= roundoff(a, b, point) ? 0 : distance;
}

/** 以首点为原点累加，避免远离坐标原点时窄区域的鞋带项相减。 */
export function concaveSignedArea(points: readonly Point[]): number {
  if (points.length < 3) return 0;
  return points.slice(1, -1).reduce((sum, point, index) => sum + cross(points[0], point, points[index + 2]), 0) / 2;
}

function cleanPolygon(input: readonly Point[]): Point[] {
  const points: Point[] = [];
  for (const point of input) if (!points.length || length(points[points.length - 1], point) > roundoff(points[points.length - 1], point)) points.push(point);
  if (points.length > 1 && length(points[0], points[points.length - 1]) <= roundoff(points[0], points[points.length - 1])) points.pop();
  // 同向共线点只从计算副本移除，教师保存的编辑点及其身份保持原样。
  for (let index = 0; points.length >= 3 && index < points.length;) {
    const a = points[(index + points.length - 1) % points.length], b = points[index], c = points[(index + 1) % points.length];
    if (lineDistance(a, c, b) === 0 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0) {
      points.splice(index, 1); index = 0;
    } else index++;
  }
  const area = concaveSignedArea(points);
  return points.length < 3 || area === 0 ? [] : area < 0 ? points.reverse() : points;
}

/** 输入由 construction 的简单多边形合同守卫；耳切保留全部实际边界，不使用凸包。 */
export function triangulateConcavePolygon(input: readonly Point[]): Point[][] | null {
  if (input.length > 32 || input.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const boundary = cleanPolygon(input), triangles: Point[][] = [];
  if (boundary.length < 3) return null;
  while (boundary.length > 3) {
    let found = false;
    for (let index = 0; index < boundary.length; index++) {
      const previous = (index + boundary.length - 1) % boundary.length, next = (index + 1) % boundary.length;
      const a = boundary[previous], b = boundary[index], c = boundary[next];
      if (lineDistance(a, b, c) <= 0) continue;
      if (boundary.some((point, ordinal) => ordinal !== previous && ordinal !== index && ordinal !== next
        && lineDistance(a, b, point) >= 0 && lineDistance(b, c, point) >= 0 && lineDistance(c, a, point) >= 0)) continue;
      triangles.push([a, b, c]); boundary.splice(index, 1); found = true; break;
    }
    if (!found) return null;
  }
  const last = cleanPolygon(boundary);
  if (last.length) triangles.push(last);
  return triangles;
}

/** 同一次线段分割同时生成内外两侧，共用一个解析交点，避免双独立裁切重算裂缝。 */
function splitConvex(points: readonly Point[], a: Point, b: Point) {
  const inside: Point[] = [], outside: Point[] = [];
  for (let index = 0; index < points.length; index++) {
    const current = points[index], next = points[(index + 1) % points.length];
    const first = lineDistance(a, b, current), second = lineDistance(a, b, next);
    if (first >= 0) inside.push(current);
    if (first <= 0) outside.push(current);
    if (first > 0 && second < 0 || first < 0 && second > 0) {
      const fraction = first / (first - second);
      const intersection = { x: current.x + (next.x - current.x) * fraction, y: current.y + (next.y - current.y) * fraction };
      inside.push(intersection); outside.push(intersection);
    }
  }
  return { inside: cleanPolygon(inside), outside: cleanPolygon(outside) };
}

function bounds(points: readonly Point[]) {
  return { minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)), minY: Math.min(...points.map((point) => point.y)), maxY: Math.max(...points.map((point) => point.y)) };
}
function separated(a: readonly Point[], b: readonly Point[]) {
  const first = bounds(a), second = bounds(b);
  return first.maxX <= second.minX || second.maxX <= first.minX || first.maxY <= second.minY || second.maxY <= first.minY;
}

/** 两个逆时针凸计算片的准确内外分区；接触或完全分离时保留原片，避免无意义碎分。 */
function subtractConvex(a: Point[], b: Point[]) {
  if (separated(a, b)) return { intersection: [] as Point[], difference: [a] };
  let remaining = a;
  const difference: Point[][] = [];
  for (let index = 0; index < b.length && remaining.length; index++) {
    const split = splitConvex(remaining, b[index], b[(index + 1) % b.length]);
    if (split.outside.length) difference.push(split.outside);
    remaining = split.inside;
  }
  return remaining.length ? { intersection: remaining, difference } : { intersection: [], difference: [a] };
}

/**
 * A、B 的耳切三角片内部各自不交。逐片剥离后，每一片只记入交或差一次；
 * 并集为 A−B 加原 B。孔洞/分离分量由真实空白表达，不把剖分线作为教学切线。
 * 32 点材料最多各 30 个三角片，循环只遍历有限直线 arrangement，不递归扩展输入。
 */
export function concaveRegions(a: readonly Point[], b: readonly Point[]): ConcaveRegions | null {
  const first = triangulateConcavePolygon(a), second = triangulateConcavePolygon(b);
  if (!first || !second) return null;
  const intersection: Point[][] = [];
  let difference = first;
  for (const cutter of second) {
    const next: Point[][] = [];
    for (const piece of difference) {
      const split = subtractConvex(piece, cutter);
      if (split.intersection.length) intersection.push(split.intersection);
      next.push(...split.difference);
    }
    difference = next;
  }
  return { intersection, difference, union: [...difference, ...second] };
}

export const concaveRegionsArea = (regions: readonly Point[][]) => regions.reduce((sum, polygon) => sum + Math.abs(concaveSignedArea(polygon)), 0);
