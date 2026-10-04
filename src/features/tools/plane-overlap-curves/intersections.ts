import { add, arcSweep, cross, distance, dot, edgeParameter, modAngle, mul, pointError, pointOnEdge, roundoff, sameCircle, samePoint, sub, TAU, type Circle, type CurveEdge, type Point } from "./geometry";

export interface CurveIntersection { point: Point; first: number; second: number }
const unitInterval = (value: number) => value >= -roundoff(value) && value <= 1 + roundoff(value);

function lineLine(a: CurveEdge, b: CurveEdge): Point[] {
  const first = sub(a.b, a.a), second = sub(b.b, b.a), between = sub(b.a, a.a), denominator = cross(first, second);
  const determinantError = roundoff(first.x * second.y, first.y * second.x);
  if (Math.abs(denominator) > determinantError) {
    const t = cross(between, second) / denominator, u = cross(between, first) / denominator;
    return unitInterval(t) && unitInterval(u) ? [add(a.a, mul(first, Math.max(0, Math.min(1, t))))] : [];
  }
  if (Math.abs(cross(first, between)) > pointError(a.a, a.b, b.a, b.b) * distance(a.a, a.b)) return [];
  return [a.a, a.b, b.a, b.b].filter((p) => pointOnEdge(p, a) && pointOnEdge(p, b));
}

/** 沿线的投影与垂距求根，避免二次式 b²−4ac 在近切位置相消。 */
function lineCircle(line: CurveEdge, circle: Circle): Point[] {
  const length = distance(line.a, line.b), direction = mul(sub(line.b, line.a), 1 / length), relative = sub(circle.center, line.a);
  const projection = dot(relative, direction), perpendicular = cross(relative, direction), gap = circle.radius - Math.abs(perpendicular);
  if (gap < -roundoff(circle.radius, perpendicular, relative.x, relative.y)) return [];
  const half = Math.sqrt(Math.max(0, gap * (circle.radius + Math.abs(perpendicular))));
  return (half ? [projection - half, projection + half] : [projection]).flatMap((position) => {
    const t = position / length; return unitInterval(t) ? [add(line.a, mul(direction, Math.max(0, Math.min(length, position))))] : [];
  });
}

/** 两圆共弦；半弦用四个正因子的 Heron 形式，在内外相切附近保留有效小量。 */
export function circleIntersections(a: Circle, b: Circle): Point[] {
  const d = distance(a.center, b.center), sum = a.radius + b.radius, difference = Math.abs(a.radius - b.radius);
  const error = roundoff(a.radius, b.radius, d, a.center.x, a.center.y, b.center.x, b.center.y);
  if (sameCircle(a, b) || !d || d > sum + error || d < difference - error) return [];
  const along = (d + (a.radius - b.radius) * (a.radius + b.radius) / d) / 2;
  const product = Math.max(0, sum - d) * (sum + d) * Math.max(0, d - difference) * (d + difference);
  const half = Math.sqrt(product) / (2 * d), direction = mul(sub(b.center, a.center), 1 / d), base = add(a.center, mul(direction, along));
  return half ? [add(base, { x: -direction.y * half, y: direction.x * half }), add(base, { x: direction.y * half, y: -direction.x * half })] : [base];
}

export function coincidentSupports(a: CurveEdge, b: CurveEdge): boolean {
  if (a.circle || b.circle) return !!a.circle && !!b.circle && sameCircle(a.circle, b.circle);
  const vector = sub(a.b, a.a), length = distance(a.a, a.b);
  return Math.abs(cross(vector, sub(b.a, a.a))) <= pointError(a.a, a.b, b.a) * length
    && Math.abs(cross(vector, sub(b.b, a.a))) <= pointError(a.a, a.b, b.b) * length;
}

export function edgeIntersections(a: CurveEdge, b: CurveEdge): CurveIntersection[] {
  let points: Point[];
  if (!a.circle && !b.circle) points = lineLine(a, b);
  else if (a.circle && b.circle) points = sameCircle(a.circle, b.circle)
    ? [a.a, a.b, b.a, b.b].filter((point) => pointOnEdge(point, a) && pointOnEdge(point, b))
    : circleIntersections(a.circle, b.circle).filter((point) => pointOnEdge(point, a) && pointOnEdge(point, b));
  else {
    const line = a.circle ? b : a, arc = a.circle ? a : b;
    points = lineCircle(line, arc.circle!).filter((point) => pointOnEdge(point, arc));
  }
  const unique: CurveIntersection[] = [];
  for (let point of points) {
    // 既有端点优先，让两条边共享同一节点；没有屏幕距离吸附。
    point = [a.a, a.b, b.a, b.b].find((endpoint) => samePoint(point, endpoint)) ?? point;
    if (!unique.some((entry) => samePoint(entry.point, point))) unique.push({ point,
      first: Math.max(0, Math.min(1, edgeParameter(a, point))), second: Math.max(0, Math.min(1, edgeParameter(b, point))) });
  }
  return unique;
}

export function overlappingEdges(a: CurveEdge, b: CurveEdge): boolean {
  if (!coincidentSupports(a, b)) return false;
  if (!a.circle || !b.circle) {
    const from = edgeParameter(a, b.a), to = edgeParameter(a, b.b);
    return Math.min(1, Math.max(from, to)) - Math.max(0, Math.min(from, to)) > pointError(a.a, a.b, b.a, b.b) / distance(a.a, a.b);
  }
  const start = (edge: CurveEdge) => modAngle(Math.atan2(edge.a.y - edge.circle!.center.y, edge.a.x - edge.circle!.center.x) + (edge.direction === -1 ? arcSweep(edge) : 0));
  const first = start(a), second = start(b), aLength = Math.abs(arcSweep(a)), bLength = Math.abs(arcSweep(b));
  for (let shift = -1; shift <= 1; shift++) if (Math.min(first + aLength, second + shift * TAU + bLength) - Math.max(first, second + shift * TAU) > roundoff(TAU)) return true;
  return false;
}
