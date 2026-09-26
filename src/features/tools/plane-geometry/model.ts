import { polygonArea, type PlanePoint } from "../planar-interaction/geometry";

export type Point = PlanePoint;
export interface Segment { a: Point; b: Point }
export interface Rectangle { x: number; y: number; width: number; height: number }
export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
export const radians = (degrees: number) => degrees * Math.PI / 180;
export const degrees = (angle: number) => angle * 180 / Math.PI;
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export function polar(center: Point, radius: number, angle: number): Point {
  return { x: center.x + radius * Math.cos(radians(angle)), y: center.y + radius * Math.sin(radians(angle)) };
}
export function rotatePoint(point: Point, center: Point, angle: number): Point {
  return polar(center, distance(point, center), degrees(Math.atan2(point.y - center.y, point.x - center.x)) + angle);
}
export function polygonPerimeter(points: readonly Point[]): number {
  return points.reduce((total, point, index) => total + distance(point, points[(index + 1) % points.length]), 0);
}
export function polygonSegments(points: readonly Point[]): Segment[] {
  return points.map((a, index) => ({ a, b: points[(index + 1) % points.length] }));
}
export function perpendicularFoot(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
  if (squared < 1e-12) return null;
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared;
  const foot = { x: a.x + t * dx, y: a.y + t * dy };
  return { foot, distance: distance(point, foot), parameter: t, baseDirection: { x: dx, y: dy }, heightDirection: subtract(point, foot) };
}
export function polygonAltitude(points: readonly Point[], baseIndex: number) {
  const a = points[baseIndex % points.length], b = points[(baseIndex + 1) % points.length];
  if (!a || !b) return null;
  return points.map((vertex) => ({ vertex, altitude: perpendicularFoot(vertex, a, b) }))
    .sort((left, right) => (right.altitude?.distance ?? 0) - (left.altitude?.distance ?? 0))[0];
}

/** 七片严格铺满同一个 4×4 正方形；初始边界由坐标决定，不靠像素摆图。 */
export const TANGRAM_PIECES: readonly (readonly Point[])[] = [
  [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 2 }],
  [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 4 }],
  [{ x: 4, y: 2 }, { x: 4, y: 4 }, { x: 2, y: 4 }],
  [{ x: 4, y: 0 }, { x: 4, y: 2 }, { x: 3, y: 1 }],
  [{ x: 1, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 3 }],
  [{ x: 2, y: 2 }, { x: 3, y: 1 }, { x: 4, y: 2 }, { x: 3, y: 3 }],
  [{ x: 0, y: 4 }, { x: 1, y: 3 }, { x: 3, y: 3 }, { x: 2, y: 4 }],
];
export function tangramPiece(index: number, offset: Point, scale: number, angle = 0, reflected: boolean | number = false): Point[] {
  const points = TANGRAM_PIECES[index] ?? [];
  const center = { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  const reflection = typeof reflected === "number" ? clamp(reflected, -1, 1) : reflected ? -1 : 1;
  return points.map((point) => {
    const local = { x: center.x + (point.x - center.x) * reflection, y: point.y };
    const rotated = rotatePoint(local, center, angle);
    return { x: offset.x + rotated.x * scale, y: offset.y + rotated.y * scale };
  });
}
export function interiorAngle(a: Point, vertex: Point, b: Point): number {
  const first = subtract(a, vertex), second = subtract(b, vertex);
  const length = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
  return length < 1e-12 ? 0 : degrees(Math.acos(clamp((first.x * second.x + first.y * second.y) / length, -1, 1)));
}
export function triangleAngles(points: readonly Point[]): number[] {
  return points.map((point, index) => interiorAngle(points[(index + 2) % 3], point, points[(index + 1) % 3]));
}
/** 不可合拢时返回真实两杆端点，供舞台显示间隙；不输出题目判分。 */
export function threeRodGeometry(base: number, left: number, right: number) {
  if (![base, left, right].every((value) => Number.isFinite(value) && value > 0)) return null;
  const x = (base * base + left * left - right * right) / (2 * base);
  const heightSquared = left * left - x * x;
  const closed = heightSquared > 1e-10 && base < left + right && base > Math.abs(left - right);
  if (closed) {
    const joint = { x, y: -Math.sqrt(heightSquared) };
    return { leftJoint: joint, rightJoint: joint, gap: 0, closed };
  }
  const toward = base >= left + right ? 0 : left >= base + right ? 0 : 180;
  const leftJoint = polar({ x: 0, y: 0 }, left, toward);
  const rightJoint = polar({ x: base, y: 0 }, right, base >= left + right || right >= base + left ? 180 : 0);
  return { leftJoint, rightJoint, gap: distance(leftJoint, rightJoint), closed };
}
export function hingedFrame(base: number, side: number, opening: number): Point[] {
  const offset = polar({ x: 0, y: 0 }, side, -clamp(opening, 10, 170));
  return [{ x: 0, y: 0 }, { x: base, y: 0 }, { x: base + offset.x, y: offset.y }, offset];
}
export type QuadrilateralFamily = "rectangle" | "square" | "parallelogram" | "rhombus" | "trapezoid";
export function quadrilateral(family: QuadrilateralFamily, width: number, height: number, slant: number): Point[] {
  const h = family === "square" ? width : height;
  const shift = family === "rectangle" || family === "square" ? 0 : family === "rhombus" ? clamp(slant, -width * 0.95, width * 0.95) : slant;
  const actualHeight = family === "rhombus" ? Math.sqrt(Math.max(0, width * width - shift * shift)) : h;
  const topWidth = family === "trapezoid" ? width * 0.55 : width;
  return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: shift + topWidth, y: -actualHeight }, { x: shift, y: -actualHeight }];
}
export function clockHands(minutes: number) {
  const normalized = ((minutes % 720) + 720) % 720;
  const hour = normalized * 0.5, minute = (normalized * 6) % 360;
  const difference = Math.abs(hour - minute);
  return { hour, minute, smallerAngle: Math.min(difference, 360 - difference), largerAngle: Math.max(difference, 360 - difference) };
}

/** 整段刚体旋转/平移，动画中边长也保持，不把两端直线插值冒充搬边。 */
export function straightenBoundary(points: readonly Point[], origin: Point, progress: number): Segment[] {
  let along = 0;
  return polygonSegments(points).map((segment) => {
    const length = distance(segment.a, segment.b), target = { x: origin.x + along, y: origin.y };
    along += length;
    const t = clamp(progress, 0, 1);
    const a = { x: segment.a.x + (target.x - segment.a.x) * t, y: segment.a.y + (target.y - segment.a.y) * t };
    const angle = degrees(Math.atan2(segment.b.y - segment.a.y, segment.b.x - segment.a.x));
    return { a, b: polar(a, length, angle * (1 - t)) };
  });
}
export function samePerimeterRectangle(perimeter: number, width: number): Rectangle {
  const safeWidth = clamp(width, 0.25, perimeter / 2 - 0.25);
  return { x: 0, y: 0, width: safeWidth, height: perimeter / 2 - safeWidth };
}
export function sameAreaRectangle(area: number, width: number): Rectangle {
  const safeWidth = Math.max(0.25, width);
  return { x: 0, y: 0, width: safeWidth, height: area / safeWidth };
}
export function rectanglePoints(rectangle: Rectangle): Point[] {
  return [{ x: rectangle.x, y: rectangle.y }, { x: rectangle.x + rectangle.width, y: rectangle.y },
    { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height }, { x: rectangle.x, y: rectangle.y + rectangle.height }];
}
/** 用所有边界坐标分格计算并集，部分贴合、完全贴合和交叠都使用同一口径。 */
export function rectangleUnion(rectangles: readonly Rectangle[]) {
  const xs = [...new Set(rectangles.flatMap((r) => [r.x, r.x + r.width]))].sort((a, b) => a - b);
  const ys = [...new Set(rectangles.flatMap((r) => [r.y, r.y + r.height]))].sort((a, b) => a - b);
  const occupied = new Set<string>();
  for (let x = 0; x + 1 < xs.length; x++) for (let y = 0; y + 1 < ys.length; y++) {
    const mid = { x: (xs[x] + xs[x + 1]) / 2, y: (ys[y] + ys[y + 1]) / 2 };
    if (rectangles.some((r) => mid.x > r.x && mid.x < r.x + r.width && mid.y > r.y && mid.y < r.y + r.height)) occupied.add(`${x}:${y}`);
  }
  let area = 0, perimeter = 0;
  const boundary: Segment[] = [];
  occupied.forEach((key) => {
    const [x, y] = key.split(":").map(Number), width = xs[x + 1] - xs[x], height = ys[y + 1] - ys[y];
    area += width * height;
    const neighbors = [
      { key: `${x - 1}:${y}`, a: { x: xs[x], y: ys[y] }, b: { x: xs[x], y: ys[y + 1] } },
      { key: `${x + 1}:${y}`, a: { x: xs[x + 1], y: ys[y] }, b: { x: xs[x + 1], y: ys[y + 1] } },
      { key: `${x}:${y - 1}`, a: { x: xs[x], y: ys[y] }, b: { x: xs[x + 1], y: ys[y] } },
      { key: `${x}:${y + 1}`, a: { x: xs[x], y: ys[y + 1] }, b: { x: xs[x + 1], y: ys[y + 1] } },
    ];
    neighbors.forEach((edge) => { if (!occupied.has(edge.key)) { boundary.push({ a: edge.a, b: edge.b }); perimeter += distance(edge.a, edge.b); } });
  });
  return { area, perimeter, boundary };
}
export function sharedRectangleSeams(a: Rectangle, b: Rectangle): Segment[] {
  const result: Segment[] = [], tolerance = 1e-8;
  const loY = Math.max(a.y, b.y), hiY = Math.min(a.y + a.height, b.y + b.height);
  const loX = Math.max(a.x, b.x), hiX = Math.min(a.x + a.width, b.x + b.width);
  if (hiY > loY) {
    if (Math.abs(a.x + a.width - b.x) < tolerance) result.push({ a: { x: b.x, y: loY }, b: { x: b.x, y: hiY } });
    if (Math.abs(b.x + b.width - a.x) < tolerance) result.push({ a: { x: a.x, y: loY }, b: { x: a.x, y: hiY } });
  }
  if (hiX > loX) {
    if (Math.abs(a.y + a.height - b.y) < tolerance) result.push({ a: { x: loX, y: b.y }, b: { x: hiX, y: b.y } });
    if (Math.abs(b.y + b.height - a.y) < tolerance) result.push({ a: { x: loX, y: a.y }, b: { x: hiX, y: a.y } });
  }
  return result;
}
function onSegment(p: Point, a: Point, b: Point) {
  const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
  return Math.abs(cross) < 1e-8 && p.x >= Math.min(a.x, b.x) - 1e-8 && p.x <= Math.max(a.x, b.x) + 1e-8 && p.y >= Math.min(a.y, b.y) - 1e-8 && p.y <= Math.max(a.y, b.y) + 1e-8;
}
export function pointInPolygon(point: Point, polygon: readonly Point[]): "inside" | "boundary" | "outside" {
  if (polygonSegments(polygon).some(({ a, b }) => onSegment(point, a, b))) return "boundary";
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? "inside" : "outside";
}
export function simplePolygon(points: readonly Point[]): boolean {
  if (points.length < 3 || polygonArea(points) < 1e-8) return false;
  if (points.some((point, index) => points.some((other, j) => j !== index && distance(point, other) < 1e-8))) return false;
  const segments = polygonSegments(points);
  const orient = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    if (j === i + 1 || (i === 0 && j === segments.length - 1)) continue;
    const { a, b } = segments[i], { a: c, b: d } = segments[j];
    const values = [orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)];
    if (values[0] * values[1] < 0 && values[2] * values[3] < 0) return false;
    if (onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d)) return false;
  }
  return true;
}
/** 仅简单、无孔、整数顶点的多边形提供格点关系。 */
export function latticeCounts(polygon: readonly Point[]) {
  if (!simplePolygon(polygon) || polygon.some((p) => !Number.isInteger(p.x) || !Number.isInteger(p.y))) return null;
  const minX = Math.min(...polygon.map((p) => p.x)), maxX = Math.max(...polygon.map((p) => p.x));
  const minY = Math.min(...polygon.map((p) => p.y)), maxY = Math.max(...polygon.map((p) => p.y));
  const inside: Point[] = [], boundary: Point[] = [];
  // 场景只接收有限教具点阵，防止畸形保存参数制造无界遍历。
  if ((maxX - minX + 1) * (maxY - minY + 1) > 10000) return null;
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
    const point = { x, y }, kind = pointInPolygon(point, polygon);
    if (kind === "inside") inside.push(point);
    if (kind === "boundary") boundary.push(point);
  }
  return { inside, boundary, area: polygonArea(polygon), pickArea: inside.length + boundary.length / 2 - 1 };
}
export function staircasePolygon(width: number, height: number, steps: number, notch = 0): Point[] {
  const count = clamp(Math.round(steps), 2, 8), result: Point[] = [{ x: 0, y: 0 }, { x: width, y: 0 }];
  for (let i = 0; i < count; i++) {
    result.push({ x: width - width * i / count, y: height * (i + 1) / count });
    result.push({ x: width - width * (i + 1) / count, y: height * (i + 1) / count });
  }
  if (notch > 0) result.push({ x: 0, y: height * 0.65 }, { x: notch, y: height * 0.65 }, { x: notch, y: height * 0.35 }, { x: 0, y: height * 0.35 });
  return result;
}
/** 简单多边形耳切，用真实纸片覆盖原区域；返回三角片而非图案近似。 */
export function triangulatePolygon(points: readonly Point[]): Point[][] {
  if (!simplePolygon(points)) return [];
  const signed = points.reduce((sum, p, index) => {
    const next = points[(index + 1) % points.length];
    return sum + p.x * next.y - next.x * p.y;
  }, 0);
  const indices = points.map((_, index) => index), triangles: Point[][] = [];
  const turn = signed >= 0 ? 1 : -1;
  while (indices.length > 3) {
    let found = false;
    for (let i = 0; i < indices.length; i++) {
      const before = indices[(i + indices.length - 1) % indices.length], current = indices[i], after = indices[(i + 1) % indices.length];
      const a = points[before], b = points[current], c = points[after];
      if (((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) * turn <= 1e-8) continue;
      const triangle = [a, b, c];
      if (indices.some((index) => index !== before && index !== current && index !== after && pointInPolygon(points[index], triangle) !== "outside")) continue;
      triangles.push(triangle); indices.splice(i, 1); found = true; break;
    }
    if (!found) return [];
  }
  triangles.push(indices.map((index) => points[index]));
  return triangles;
}
