import type { PlanarPoint as Point } from "../planar-kit/contract";

export type { PlanarPoint as Point } from "../planar-kit/contract";
export interface Circle { center: Point; radius: number }
export interface CurveEdge { a: Point; b: Point; circle?: Circle; direction?: 1 | -1 }
export interface CurveRegion { loops: CurveEdge[][] }
export const TAU = 2 * Math.PI;
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Point, value: number): Point => ({ x: a.x * value, y: a.y * value });
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const normalizeAngle = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;
export const modAngle = (angle: number) => (angle % TAU + TAU) % TAU;
/** 只合并坐标尺度上的舍入误差；不以像素、网格或固定面积删去小区域。 */
export const roundoff = (...values: number[]) => 32 * Number.EPSILON * Math.max(1, ...values.map(Math.abs));
export const pointError = (...points: Point[]) => roundoff(...points.flatMap((p) => [p.x, p.y]));
export const samePoint = (a: Point, b: Point) => distance(a, b) <= pointError(a, b);
export const sameCircle = (a: Circle, b: Circle) => samePoint(a.center, b.center) && Math.abs(a.radius - b.radius) <= roundoff(a.radius, b.radius);

export function arcSweep(edge: CurveEdge): number {
  if (!edge.circle || samePoint(edge.a, edge.b)) return 0;
  const a = sub(edge.a, edge.circle.center), b = sub(edge.b, edge.circle.center);
  let angle = Math.atan2(cross(a, b), dot(a, b));
  if (edge.direction === 1 && angle <= 0) angle += TAU;
  if (edge.direction === -1 && angle >= 0) angle -= TAU;
  return angle;
}

export function edgePoint(edge: CurveEdge, t: number): Point {
  if (t === 0) return edge.a;
  if (t === 1) return edge.b;
  if (!edge.circle) return add(edge.a, mul(sub(edge.b, edge.a), t));
  const vector = sub(edge.a, edge.circle.center), turn = arcSweep(edge) * t, c = Math.cos(turn), s = Math.sin(turn);
  return add(edge.circle.center, { x: vector.x * c - vector.y * s, y: vector.x * s + vector.y * c });
}

export function edgeTangent(edge: CurveEdge, t: number): Point {
  if (!edge.circle) { const vector = sub(edge.b, edge.a); return mul(vector, 1 / Math.hypot(vector.x, vector.y)); }
  const vector = sub(edgePoint(edge, t), edge.circle.center);
  return { x: -vector.y / edge.circle.radius * edge.direction!, y: vector.x / edge.circle.radius * edge.direction! };
}

export function edgeParameter(edge: CurveEdge, point: Point): number {
  if (samePoint(point, edge.a)) return 0;
  if (samePoint(point, edge.b)) return 1;
  if (!edge.circle) { const vector = sub(edge.b, edge.a); return dot(sub(point, edge.a), vector) / dot(vector, vector); }
  const a = sub(edge.a, edge.circle.center), b = sub(point, edge.circle.center);
  const angle = Math.atan2(cross(a, b), dot(a, b)), signed = edge.direction === 1 ? modAngle(angle) : -modAngle(-angle);
  return signed / arcSweep(edge);
}

export function pointOnEdge(point: Point, edge: CurveEdge): boolean {
  const error = pointError(point, edge.a, edge.b, ...(edge.circle ? [edge.circle.center] : []));
  if (edge.circle) {
    if (Math.abs(distance(point, edge.circle.center) - edge.circle.radius) > error + roundoff(edge.circle.radius)) return false;
  } else {
    const vector = sub(edge.b, edge.a), length = distance(edge.a, edge.b);
    if (!length || Math.abs(cross(vector, sub(point, edge.a))) > error * length) return false;
  }
  const t = edgeParameter(edge, point);
  return t >= -roundoff(t) && t <= 1 + roundoff(t);
}

export const reverseEdge = (edge: CurveEdge): CurveEdge => ({ ...edge, a: edge.b, b: edge.a, ...(edge.circle ? { direction: -edge.direction! as 1 | -1 } : {}) });
export const reverseLoop = (loop: readonly CurveEdge[]) => [...loop].reverse().map(reverseEdge);
export const regionEdges = (region: CurveRegion) => region.loops.flat();

function angleMinusSin(angle: number): number {
  if (Math.abs(angle) >= .01) return angle - Math.sin(angle);
  const squared = angle * angle;
  return angle * squared / 6 * (1 - squared / 20 * (1 - squared / 42 * (1 - squared / 72)));
}

/** 平移到本环首点后作鞋带积分，圆弧再加真实圆弓面积；孔的负绕序自然相减。 */
export function loopArea(loop: readonly CurveEdge[]): number {
  if (!loop.length) return 0;
  const origin = loop[0].a;
  let value = 0, compensation = 0;
  for (const edge of loop) {
    const term = cross(sub(edge.a, origin), sub(edge.b, origin)) / 2
      + (edge.circle ? edge.circle.radius ** 2 * angleMinusSin(arcSweep(edge)) / 2 : 0);
    const adjusted = term - compensation, next = value + adjusted;
    compensation = (next - value) - adjusted; value = next;
  }
  return value;
}
export const regionArea = (region: CurveRegion) => region.loops.reduce((sum, loop) => sum + loopArea(loop), 0);
export const regionPerimeter = (region: CurveRegion) => regionEdges(region).reduce((sum, edge) => sum + (edge.circle ? edge.circle.radius * Math.abs(arcSweep(edge)) : distance(edge.a, edge.b)), 0);

/** 水平射线与圆弧真实交点计绕数；先在 y 极值处分段，端点采用同一半开规则。 */
export function pointWinding(point: Point, region: CurveRegion): number {
  let winding = 0;
  for (const original of regionEdges(region)) {
    const stops = [0, 1];
    if (original.circle) for (const direction of [-1, 1]) {
      const at = { x: original.circle.center.x, y: original.circle.center.y + direction * original.circle.radius };
      const t = edgeParameter(original, at); if (t > 0 && t < 1 && pointOnEdge(at, original)) stops.push(t);
    }
    stops.sort((a, b) => a - b);
    for (let i = 1; i < stops.length; i++) {
      const a = edgePoint(original, stops[i - 1]), b = edgePoint(original, stops[i]);
      const up = a.y <= point.y && b.y > point.y, down = b.y <= point.y && a.y > point.y;
      if (!up && !down) continue;
      let x: number;
      if (!original.circle) x = a.x + (point.y - a.y) * (b.x - a.x) / (b.y - a.y);
      else {
        const { center, radius } = original.circle, y = point.y - center.y;
        const root = Math.sqrt(Math.max(0, (radius - Math.abs(y)) * (radius + Math.abs(y))));
        const middle = edgePoint(original, (stops[i - 1] + stops[i]) / 2);
        x = center.x + (middle.x >= center.x ? root : -root);
      }
      if (x > point.x) winding += up ? 1 : -1;
    }
  }
  return winding;
}
export function locatePoint(point: Point, region: CurveRegion): -1 | 0 | 1 {
  if (regionEdges(region).some((edge) => pointOnEdge(point, edge))) return 0;
  return pointWinding(point, region) ? 1 : -1;
}

export function polygonRegion(points: readonly Point[]): CurveRegion {
  let loop = points.map((a, i) => ({ a: { ...a }, b: { ...points[(i + 1) % points.length] } }));
  if (loopArea(loop) < 0) loop = reverseLoop(loop);
  return { loops: loop.length ? [loop] : [] };
}
export function circleRegion(center: Point, radius: number): CurveRegion {
  const circle = { center, radius }, a = { x: center.x + radius, y: center.y }, b = { x: center.x - radius, y: center.y };
  return { loops: [[{ a, b, circle, direction: 1 }, { a: b, b: a, circle, direction: 1 }]] };
}

export function transformRegion(region: CurveRegion, origin: Point, angle = 0, flip = 1): CurveRegion {
  const radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  const transform = (point: Point) => add(origin, { x: c * point.x * flip - s * point.y, y: s * point.x * flip + c * point.y });
  const loops = region.loops.map((loop) => loop.map((edge): CurveEdge => ({ a: transform(edge.a), b: transform(edge.b),
    ...(edge.circle ? { circle: { center: transform(edge.circle.center), radius: edge.circle.radius }, direction: edge.direction! * flip as 1 | -1 } : {}) })));
  return { loops: flip === -1 ? loops.map(reverseLoop) : loops };
}

export function regionBounds(region: CurveRegion) {
  const points = regionEdges(region).flatMap((edge) => {
    const result = [edge.a];
    if (edge.circle) for (const vector of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]) {
      const point = add(edge.circle.center, mul(vector, edge.circle.radius)); if (pointOnEdge(point, edge)) result.push(point);
    }
    return result;
  });
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x)), minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
export function regionPath(region: CurveRegion): string {
  return region.loops.map((loop) => `M ${loop[0].a.x} ${loop[0].a.y} ` + loop.map((edge) => edge.circle
    ? `A ${edge.circle.radius} ${edge.circle.radius} 0 ${Math.abs(arcSweep(edge)) > Math.PI ? 1 : 0} ${edge.direction === 1 ? 1 : 0} ${edge.b.x} ${edge.b.y}`
    : `L ${edge.b.x} ${edge.b.y}`).join(" ") + " Z").join(" ");
}
