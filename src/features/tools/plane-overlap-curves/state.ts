import type { PlanarState } from "../planar-kit/contract";
import { sameCircle, type Circle, type CurveEdge, type CurveRegion, type Point } from "./geometry";

export const CURVE_SCENE = "33-curves";
export const CURVE_VERSION = "plane-overlap-lesson-v4";
export const CURVE_LIMIT = 16;
export const CURVE_BOUND = 4000;
export const CURVE_POINT_LIMIT = 192;
export const CURVE_SUPPORT_LIMIT = 32;
export const CURVE_LOOP_LIMIT = 32;
export const CURVE_RADIUS_MIN = 4;
export const CURVE_RADIUS_MAX = 1600;
export const CURVE_UNIT = 1;
export const CURVE_FLAGS = ["grid", "measures", "guides", "ghost", "edit"] as const;
export const CURVE_GLOBAL_PARAMS = ["nextId", "active", "pairA", "pairB", "region", "vertex"] as const;

/** 0 是自由直边纸片，1 是可调半径的真圆，2 是已冻结边界的曲边材料。 */
export interface CurveMaterial {
  id: number; kind: 0 | 1 | 2; angle: number; flip: 1 | -1;
  origin: Point; home: Point; region: CurveRegion; reference: boolean;
}

export function curveMaterial(state: PlanarState, id = state.params.active): CurveMaterial | null {
  try {
    const kind = state.params[`kind.${id}`], loopCount = state.params[`loops.${id}`], circleCount = state.params[`circles.${id}`];
    if (!Number.isInteger(id) || id < 0 || !Number.isInteger(kind) || !Number.isInteger(loopCount) || loopCount < 1 || loopCount > CURVE_LOOP_LIMIT
      || !Number.isInteger(circleCount) || circleCount < 0 || circleCount > CURVE_SUPPORT_LIMIT) return null;
    const circles = Array.from({ length: circleCount }, (_, index) => ({ center: state.points[`circle.${id}.${index}`], radius: state.params[`radius.${id}.${index}`] }));
    let index = 0;
    const loops: CurveEdge[][] = [];
    for (let loop = 0; loop < loopCount; loop++) {
      const count = state.params[`count.${id}.${loop}`];
      if (!Number.isInteger(count) || count < 2 || count > CURVE_POINT_LIMIT || index + count > CURVE_POINT_LIMIT) return null;
      const start = index;
      loops.push(Array.from({ length: count }, (_, ordinal) => {
        const key = index++, code = state.params[`arc.${id}.${key}`] ?? 0;
        return { a: state.points[`vertex.${id}.${key}`], b: state.points[`vertex.${id}.${start + (ordinal + 1) % count}`],
          ...(code ? { circle: circles[Math.abs(code) - 1], direction: Math.sign(code) as 1 | -1 } : {}) };
      }));
    }
    return { id, kind: kind as CurveMaterial["kind"], angle: state.params[`angle.${id}`], flip: state.params[`flip.${id}`] as 1 | -1,
      origin: state.points[`origin.${id}`], home: state.points[`home.${id}`], region: { loops }, reference: state.flags[`reference.${id}`] };
  } catch { return null; }
}

export function curveMaterials(state: PlanarState): CurveMaterial[] {
  return Object.keys(state.params).flatMap((key) => /^kind\.(0|[1-9]\d{0,4})$/.test(key) ? [Number(key.slice(5))] : []).sort((a, b) => a - b)
    .flatMap((id) => { const material = curveMaterial(state, id); return material ? [material] : []; });
}

/** 边界的圆心/半径只保存一次，边上只记支撑圆编号与方向；直线没有 arc 键。 */
export function writeCurveMaterials(state: PlanarState, materials: readonly CurveMaterial[]): PlanarState {
  const params: PlanarState["params"] = Object.fromEntries(CURVE_GLOBAL_PARAMS.map((key) => [key, state.params[key]]));
  const points: PlanarState["points"] = {};
  const flags: PlanarState["flags"] = Object.fromEntries(CURVE_FLAGS.map((key) => [key, state.flags[key]]));
  for (const material of materials) {
    const { id, region } = material, circles: Circle[] = [];
    Object.assign(params, { [`kind.${id}`]: material.kind, [`angle.${id}`]: material.angle, [`flip.${id}`]: material.flip, [`loops.${id}`]: region.loops.length });
    points[`origin.${id}`] = { ...material.origin }; points[`home.${id}`] = { ...material.home };
    flags[`reference.${id}`] = material.reference;
    let index = 0;
    region.loops.forEach((loop, loopIndex) => {
      params[`count.${id}.${loopIndex}`] = loop.length;
      for (const edge of loop) {
        points[`vertex.${id}.${index}`] = { ...edge.a };
        if (edge.circle) {
          let support = circles.findIndex((circle) => sameCircle(circle, edge.circle!));
          if (support < 0) { support = circles.length; circles.push(edge.circle); }
          params[`arc.${id}.${index}`] = (support + 1) * edge.direction!;
        }
        index++;
      }
    });
    params[`circles.${id}`] = circles.length;
    circles.forEach((circle, support) => { points[`circle.${id}.${support}`] = { ...circle.center }; params[`radius.${id}.${support}`] = circle.radius; });
  }
  return { ...state, params, points, flags };
}
