import type { PlanarState } from "../planar-kit/contract";
import { DIMENSION_MAX, DIMENSION_MIN, isSimpleWorkbenchPolygon, LOCAL_BOUND, POLYGON_BOUND, POLYGON_DIMENSIONS, POLYGON_LIMIT, POLYGON_SCENE, polygonVertexCount, type PolygonKind } from "./geometry";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: unknown, allowed: readonly string[]) => record(value) && Object.keys(value).length === allowed.length && allowed.every((key) => Object.hasOwn(value, key));
const number = (value: unknown, min: number, max: number, integer = false): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
const point = (value: unknown, bound: number) => keys(value, ["x", "y"]) && record(value) && number(value.x, -bound, bound) && number(value.y, -bound, bound);

/** 只保存材料约束及角片的刚性位姿；框架与角片的每个暂停位置也是准确几何。 */
export function isValidPolygonWorkbenchState(state: PlanarState | undefined): state is PlanarState {
  if (!state || !keys(state, ["sceneId", "params", "points", "flags", "marks", "phase"]) || state.sceneId !== POLYGON_SCENE
    || state.phase !== 0 || !Array.isArray(state.marks) || state.marks.length || !record(state.params) || !record(state.points) || !record(state.flags)) return false;
  const p = state.params;
  if (!number(p.count, 0, POLYGON_LIMIT, true) || !number(p.active, p.count ? 0 : -1, p.count - 1, true) || !number(p.vertex, 0, 3, true)) return false;
  const params = ["count", "active", "vertex"], points: string[] = [], flags = ["grid", "measures", "names"];
  for (let id = 0; id < p.count; id++) {
    const kind = p[`kind.${id}`] as PolygonKind;
    if (!number(kind, 0, 9, true) || !number(p[`rotation.${id}`], -180, 180)
      || !number(p[`base.${id}`], 0, kind < 2 ? 0 : polygonVertexCount(kind) - 1, true)) return false;
    params.push(`kind.${id}`, `rotation.${id}`, `base.${id}`); points.push(`origin.${id}`); flags.push(`height.${id}`, `angles.${id}`);
    if (!point(state.points[`origin.${id}`], POLYGON_BOUND)
      || kind < 2 && state.flags[`height.${id}`] !== false || kind !== 3 && state.flags[`angles.${id}`] !== false) return false;
    for (const key of POLYGON_DIMENSIONS[kind]) {
      params.push(`${key}.${id}`);
      const low = key === "opening" ? 5 : key === "side" ? -1 : key === "shift" ? -DIMENSION_MAX : DIMENSION_MIN;
      const high = key === "opening" ? 175 : key === "side" ? 1 : DIMENSION_MAX;
      if (!number(p[`${key}.${id}`], low, high) || key === "side" && Math.abs(p[`${key}.${id}`]) !== 1) return false;
    }
    if (kind === 3 || kind === 4) {
      const vertices = Array.from({ length: polygonVertexCount(kind) }, (_, index) => {
        const key = `vertex.${id}.${index}`; points.push(key); return state.points[key];
      });
      if (!vertices.every((at) => point(at, LOCAL_BOUND)) || !isSimpleWorkbenchPolygon(vertices)) return false;
    }
    if (state.flags[`angles.${id}`]) {
      for (let index = 0; index < 3; index++) {
        const key = `corner.${id}.${index}`, turn = `turn.${id}.${index}`; points.push(key); params.push(turn);
        if (!point(state.points[key], POLYGON_BOUND) || !number(p[turn], -180, 180)) return false;
      }
    }
  }
  return keys(p, params) && keys(state.points, points) && keys(state.flags, flags) && Object.values(state.flags).every((value) => typeof value === "boolean");
}
