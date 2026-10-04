import { add, arcSweep, cross, distance, dot, edgePoint, edgeTangent, locatePoint, loopArea, modAngle, mul, pointOnEdge, pointWinding, polygonRegion, regionBounds, regionEdges, reverseEdge, roundoff, sameCircle, samePoint, sub, TAU, type CurveEdge, type CurveRegion, type Point } from "./geometry";
import { coincidentSupports, edgeIntersections } from "./intersections";

export type RegionOperation = "intersection" | "union" | "difference";
const truth = (operation: RegionOperation, a: boolean, b: boolean) => operation === "intersection" ? a && b : operation === "union" ? a || b : a && !b;
interface Stop { t: number; point: Point }

function splitEdges(edges: readonly CurveEdge[], stops: Stop[][]): CurveEdge[] {
  return edges.flatMap((edge, index) => {
    const ordered = stops[index].sort((a, b) => a.t - b.t).filter((entry, i, all) => !i || !samePoint(entry.point, all[i - 1].point));
    return ordered.slice(1).flatMap((to, i) => samePoint(ordered[i].point, to.point) ? [] : [{ ...edge, a: ordered[i].point, b: to.point }]);
  });
}

function otherSides(edge: CurveEdge, other: CurveRegion): [boolean, boolean] {
  const middle = edgePoint(edge, .5);
  const shared = regionEdges(other).find((candidate) => coincidentSupports(edge, candidate) && pointOnEdge(middle, candidate));
  if (shared) {
    const sameDirection = dot(edgeTangent(edge, .5), edgeTangent(shared, .5)) > 0;
    return [sameDirection, !sameDirection];
  }
  // 一个开子边内没有交点，归属恒定；改用另一解析内点只避开浮点端点重合。
  for (const t of [.5, .375, .625]) {
    const location = locatePoint(edgePoint(edge, t), other);
    if (location) return [location === 1, location === 1];
  }
  const inside = pointWinding(middle, other) !== 0;
  return [inside, inside];
}

function cleanLoop(input: CurveEdge[]): CurveEdge[] {
  const loop = input.filter((edge) => !samePoint(edge.a, edge.b));
  for (let i = 0; loop.length > 2 && i < loop.length;) {
    const first = loop[i], nextIndex = (i + 1) % loop.length, second = loop[nextIndex];
    const straight = !first.circle && !second.circle && coincidentSupports(first, second) && dot(sub(first.b, first.a), sub(second.b, second.a)) > 0;
    const circular = first.circle && second.circle && sameCircle(first.circle, second.circle) && first.direction === second.direction
      && Math.abs(arcSweep(first) + arcSweep(second)) <= Math.PI + roundoff(Math.PI);
    if ((straight || circular) && !samePoint(first.a, second.b)) {
      const joined = { ...first, b: second.b };
      if (nextIndex === 0) { loop[i] = joined; loop.splice(0, 1); }
      else { loop[i] = joined; loop.splice(nextIndex, 1); }
      i = 0;
    } else i++;
  }
  return loop;
}

/** 共享顶点的闭合步道拆成各自环；相切不把两个面粘成一张自交纸片。 */
function simpleCycles(input: CurveEdge[]): CurveEdge[][] {
  for (let i = 0; i < input.length; i++) for (let j = i + 1; j < input.length; j++) {
    if (samePoint(input[i].a, input[j].a)) return [...simpleCycles(input.slice(i, j)), ...simpleCycles([...input.slice(0, i), ...input.slice(j)])];
  }
  const loop = cleanLoop(input);
  return loop.length >= 2 && loopArea(loop) !== 0 ? [loop] : [];
}

function traceEdges(edges: CurveEdge[]): CurveRegion | null {
  const nodes: Point[] = [];
  const node = (point: Point) => { const index = nodes.findIndex((at) => samePoint(at, point)); if (index >= 0) return index; nodes.push(point); return nodes.length - 1; };
  const graph: { edge: CurveEdge; from: number; to: number; used: boolean }[] = [];
  for (const edge of edges) {
    const from = node(edge.a), to = node(edge.b);
    if (from === to) continue;
    const sameBoundary = (candidate: CurveEdge) => coincidentSupports(candidate, edge) && pointOnEdge(edgePoint(edge, .5), candidate);
    const duplicate = graph.findIndex((entry) => entry.from === from && entry.to === to && sameBoundary(entry.edge));
    if (duplicate >= 0) continue;
    const reverse = graph.findIndex((entry) => entry.from === to && entry.to === from && sameBoundary(entry.edge));
    if (reverse >= 0) { graph.splice(reverse, 1); continue; }
    graph.push({ edge: { ...edge, a: nodes[from], b: nodes[to] }, from, to, used: false });
  }
  const outgoing = nodes.map((_, index) => graph.flatMap((entry, i) => entry.from === index ? [i] : []));
  if (nodes.some((_, index) => outgoing[index].length !== graph.filter((entry) => entry.to === index).length)) return null;
  const loops: CurveEdge[][] = [];
  for (let start = 0; start < graph.length; start++) {
    if (graph[start].used) continue;
    const loop: CurveEdge[] = [], initial = graph[start].from;
    let current = start;
    for (let count = 0; count <= graph.length; count++) {
      const entry = graph[current];
      if (entry.used) return null;
      entry.used = true; loop.push(entry.edge);
      if (entry.to === initial) { loops.push(...simpleCycles(loop)); break; }
      const candidates = outgoing[entry.to].filter((id) => !graph[id].used);
      if (!candidates.length) return null;
      const tangent = edgeTangent(entry.edge, 1), reverseAngle = Math.atan2(-tangent.y, -tangent.x);
      const reverseCurvature = entry.edge.circle ? -entry.edge.direction! / entry.edge.circle.radius : 0;
      const turn = (id: number) => {
        const candidate = graph[id].edge, vector = edgeTangent(candidate, 0), angle = Math.atan2(vector.y, vector.x);
        let value = modAngle(reverseAngle - angle);
        if (value < roundoff(TAU) || TAU - value < roundoff(TAU)) {
          const curvature = candidate.circle ? candidate.direction! / candidate.circle.radius : 0;
          value = curvature <= reverseCurvature ? 0 : TAU;
        }
        return value;
      };
      current = candidates.reduce((best, id) => turn(id) < turn(best) ? id : best);
    }
  }
  return { loops };
}

/** 解析 arrangement：共有交点处分边，按布尔真值选择边的左右面，再还原闭环。 */
export function booleanRegions(a: CurveRegion, b: CurveRegion, operation: RegionOperation): CurveRegion | null {
  const first = regionEdges(a), second = regionEdges(b);
  const stops = (edges: CurveEdge[]) => edges.map((edge) => [{ t: 0, point: edge.a }, { t: 1, point: edge.b }]);
  const firstStops = stops(first), secondStops = stops(second);
  first.forEach((edge, i) => second.forEach((other, j) => {
    for (const intersection of edgeIntersections(edge, other)) {
      firstStops[i].push({ t: intersection.first, point: intersection.point });
      secondStops[j].push({ t: intersection.second, point: intersection.point });
    }
  }));
  const select = (edges: CurveEdge[], other: CurveRegion, fromFirst: boolean) => edges.flatMap((edge) => {
    const [otherLeft, otherRight] = otherSides(edge, other);
    const left = fromFirst ? truth(operation, true, otherLeft) : truth(operation, otherLeft, true);
    const right = fromFirst ? truth(operation, false, otherRight) : truth(operation, otherRight, false);
    return left === right ? [] : [left ? edge : reverseEdge(edge)];
  });
  return traceEdges([...select(splitEdges(first, firstStops), b, true), ...select(splitEdges(second, secondStops), a, false)]);
}

/** 用严格包住原区域的有限矩形表示这一半平面；其余三条边均在真实外框之外。 */
export function cutRegion(region: CurveRegion, a: Point, b: Point): [CurveRegion, CurveRegion] | null {
  const length = distance(a, b);
  if (length <= roundoff(a.x, a.y, b.x, b.y)) return null;
  const direction = mul(sub(b, a), 1 / length), normal = { x: -direction.y, y: direction.x }, bounds = regionBounds(region);
  const corners = [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }];
  const margin = Math.max(1, bounds.width, bounds.height), along = corners.map((p) => dot(sub(p, a), direction)), across = corners.map((p) => dot(sub(p, a), normal));
  const low = Math.min(...along) - margin, high = Math.max(...along) + margin, depth = Math.max(margin, ...across) + margin;
  const point = (x: number, y: number) => add(a, add(mul(direction, x), mul(normal, y)));
  const half = polygonRegion([point(low, 0), point(high, 0), point(high, depth), point(low, depth)]);
  const left = booleanRegions(region, half, "intersection"), right = booleanRegions(region, half, "difference");
  return left && right ? [left, right] : null;
}

/** 每个正绕序外环带上其最近的负绕序孔；嵌套正岛仍是一份独立材料。 */
export function regionComponents(region: CurveRegion): CurveRegion[] {
  const components = region.loops.filter((loop) => loopArea(loop) > 0).map((loop) => ({ loops: [loop] }));
  for (const hole of region.loops.filter((loop) => loopArea(loop) < 0)) {
    const point = edgePoint(hole[0], .5);
    const containers = components.filter((component) => locatePoint(point, { loops: [component.loops[0]] }) >= 0);
    containers.sort((a, b) => loopArea(a.loops[0]) - loopArea(b.loops[0]));
    if (containers[0]) containers[0].loops.push(hole);
  }
  return components;
}

export function lineSide(a: Point, b: Point, point: Point): number {
  return cross(sub(b, a), sub(point, a));
}
