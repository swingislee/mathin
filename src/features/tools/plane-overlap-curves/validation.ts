import type { PlanarState } from "../planar-kit/contract";
import { arcSweep, distance, edgePoint, locatePoint, loopArea, pointError, regionArea, regionEdges, roundoff, samePoint, type CurveRegion } from "./geometry";
import { edgeIntersections, overlappingEdges } from "./intersections";
import { CURVE_BOUND, CURVE_FLAGS, CURVE_GLOBAL_PARAMS, CURVE_LIMIT, CURVE_LOOP_LIMIT, CURVE_POINT_LIMIT, CURVE_RADIUS_MAX, CURVE_RADIUS_MIN, CURVE_SCENE, CURVE_SUPPORT_LIMIT, curveMaterial } from "./state";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: unknown, expected: readonly string[]) => record(value) && Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
const number = (value: unknown, min: number, max: number, integer = false): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
const point = (value: unknown) => keys(value, ["x", "y"]) && record(value) && number(value.x, -CURVE_BOUND, CURVE_BOUND) && number(value.y, -CURVE_BOUND, CURVE_BOUND);

/** 允许不同环在孤立点相切；每个环简单，环的嵌套深度与有向孔洞一致。 */
export function isValidCurveRegion(region: CurveRegion, allowEmpty = false): boolean {
  if (!region.loops.length) return allowEmpty;
  for (const loop of region.loops) {
    if (loop.length < 2 || !Number.isFinite(loopArea(loop)) || loopArea(loop) === 0) return false;
    for (let i = 0; i < loop.length; i++) {
      const edge = loop[i], next = loop[(i + 1) % loop.length];
      if (!edge.a || !edge.b || ![edge.a.x, edge.a.y, edge.b.x, edge.b.y].every(Number.isFinite) || samePoint(edge.a, edge.b) || !samePoint(edge.b, next.a)) return false;
      if (edge.circle) {
        if (!edge.circle.center || ![edge.circle.center.x, edge.circle.center.y, edge.circle.radius].every(Number.isFinite) || edge.circle.radius <= 0 || ![1, -1].includes(edge.direction!)) return false;
        const error = pointError(edge.a, edge.b, edge.circle.center) + roundoff(edge.circle.radius);
        if (Math.abs(distance(edge.a, edge.circle.center) - edge.circle.radius) > error || Math.abs(distance(edge.b, edge.circle.center) - edge.circle.radius) > error || !arcSweep(edge)) return false;
      }
      for (let j = i + 1; j < loop.length; j++) {
        const other = loop[j];
        if (overlappingEdges(edge, other)) return false;
        for (const intersection of edgeIntersections(edge, other)) {
          const adjacent = j === i + 1 && samePoint(intersection.point, edge.b) || i === 0 && j === loop.length - 1 && samePoint(intersection.point, edge.a);
          if (!adjacent) return false;
        }
      }
    }
  }
  for (let i = 0; i < region.loops.length; i++) {
    let depth = 0;
    for (let j = 0; j < region.loops.length; j++) {
      if (i === j) continue;
      const first = region.loops[i], second = region.loops[j], locations = new Set<number>();
      for (const edge of first) {
        const stops = [0, 1];
        for (const other of second) {
          if (overlappingEdges(edge, other)) return false;
          stops.push(...edgeIntersections(edge, other).map((entry) => entry.first));
        }
        stops.sort((a, b) => a - b);
        for (let part = 1; part < stops.length; part++) {
          if (stops[part] === stops[part - 1]) continue;
          const location = locatePoint(edgePoint(edge, (stops[part] + stops[part - 1]) / 2), { loops: [second] });
          if (location) locations.add(location);
        }
      }
      if (locations.size > 1 || !locations.size) return false;
      if (locations.has(1)) depth++;
    }
    if ((loopArea(region.loops[i]) > 0) !== (depth % 2 === 0)) return false;
  }
  return Number.isFinite(regionArea(region)) && regionArea(region) > 0;
}

export function isValidCurveOverlapState(state: PlanarState | undefined): state is PlanarState {
  try {
    if (!state || !keys(state, ["sceneId", "params", "points", "flags", "marks", "phase"]) || state.sceneId !== CURVE_SCENE
      || state.phase !== 0 || !Array.isArray(state.marks) || state.marks.length || !record(state.params) || !record(state.points)
      || !record(state.flags) || !Object.values(state.flags).every((value) => typeof value === "boolean")) return false;
    const p = state.params, pts = state.points;
    if (Object.keys(p).length > 256 || Object.keys(pts).length > 256 || !number(p.nextId, 1, 99999, true)
      || !number(p.active, -1, 99998, true) || !number(p.pairA, -1, 99998, true) || !number(p.pairB, -1, 99998, true)
      || !number(p.region, 0, 4, true) || !number(p.vertex, 0, CURVE_POINT_LIMIT - 1, true)) return false;
    const ids = Object.keys(p).flatMap((key) => /^kind\.(0|[1-9]\d{0,4})$/.test(key) ? [Number(key.slice(5))] : []);
    if (ids.length > CURVE_LIMIT || ids.some((id) => id >= p.nextId) || [p.active, p.pairA, p.pairB].some((id) => id !== -1 && !ids.includes(id)) || p.pairA >= 0 && p.pairA === p.pairB) return false;
    const params: string[] = [...CURVE_GLOBAL_PARAMS], points: string[] = [], flags: string[] = [...CURVE_FLAGS];
    let totalPoints = 0, totalCircles = 0, totalLoops = 0;
    for (const id of ids) {
      const kind = p[`kind.${id}`], loops = p[`loops.${id}`], circles = p[`circles.${id}`];
      if (!number(kind, 0, 2, true) || !number(p[`angle.${id}`], -180, 180) || ![-1, 1].includes(p[`flip.${id}`])
        || !number(loops, 1, CURVE_LOOP_LIMIT, true) || !number(circles, 0, CURVE_SUPPORT_LIMIT, true)) return false;
      params.push(`kind.${id}`, `angle.${id}`, `flip.${id}`, `loops.${id}`, `circles.${id}`);
      points.push(`origin.${id}`, `home.${id}`);
      flags.push(`reference.${id}`);
      if (!point(pts[`origin.${id}`]) || !point(pts[`home.${id}`])) return false;
      for (let support = 0; support < circles; support++) {
        params.push(`radius.${id}.${support}`); points.push(`circle.${id}.${support}`);
        if (!number(p[`radius.${id}.${support}`], CURVE_RADIUS_MIN, CURVE_RADIUS_MAX) || !point(pts[`circle.${id}.${support}`])) return false;
      }
      let count = 0;
      const used = new Set<number>();
      for (let loop = 0; loop < loops; loop++) {
        const size = p[`count.${id}.${loop}`]; params.push(`count.${id}.${loop}`);
        if (!number(size, 2, CURVE_POINT_LIMIT, true)) return false;
        for (let vertex = 0; vertex < size; vertex++, count++) {
          points.push(`vertex.${id}.${count}`);
          if (!point(pts[`vertex.${id}.${count}`])) return false;
          const key = `arc.${id}.${count}`;
          if (Object.hasOwn(p, key)) {
            params.push(key);
            if (!number(p[key], -circles, circles, true) || !p[key]) return false;
            used.add(Math.abs(p[key]) - 1);
          }
        }
      }
      if (used.size !== circles || kind === 0 && (circles || loops !== 1 || count < 3 || count > 32)) return false;
      const material = curveMaterial(state, id);
      if (!material || !isValidCurveRegion(material.region)) return false;
      if (kind === 0 && (regionArea(material.region) <= 1 || regionEdges(material.region).some((edge) => distance(edge.a, edge.b) < 1))) return false;
      if (kind === 1) {
        const radius = p[`radius.${id}.0`];
        if (circles !== 1 || loops !== 1 || count !== 2 || p[`arc.${id}.0`] !== 1 || p[`arc.${id}.1`] !== 1
          || pts[`circle.${id}.0`].x !== 0 || pts[`circle.${id}.0`].y !== 0
          || pts[`vertex.${id}.0`].x !== radius || pts[`vertex.${id}.0`].y !== 0 || pts[`vertex.${id}.1`].x !== -radius || pts[`vertex.${id}.1`].y !== 0) return false;
      }
      totalPoints += count; totalCircles += circles; totalLoops += loops;
    }
    return totalPoints <= CURVE_POINT_LIMIT && totalCircles <= CURVE_SUPPORT_LIMIT && totalLoops <= CURVE_LOOP_LIMIT
      && keys(p, params) && keys(pts, points) && keys(state.flags, flags);
  } catch { return false; }
}
