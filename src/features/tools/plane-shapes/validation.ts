import type { PlanarState } from "../planar-kit/contract";
import { SHAPE_KINDS } from "./model";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const number = (value: unknown, min: number, max: number, integer = false): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));

/** 与保存合同一致：不存在的对象、边、顶点及重复标记都不进入教学现场。 */
export function isValidPlaneShapesState(state: PlanarState): boolean {
  if (!record(state) || !exactKeys(state, ["sceneId", "params", "points", "flags", "marks", "phase"]) || state.sceneId !== "01-basic" || state.phase !== 0) return false;
  if (!record(state.params) || !record(state.points) || !record(state.flags) || !Array.isArray(state.marks)) return false;
  const { params, points, flags, marks } = state;
  if (!number(params.count, 0, 8, true) || !number(params.active, params.count ? 0 : -1, params.count - 1, true)) return false;
  const indexes = Array.from({ length: params.count }, (_, index) => index);
  if (!exactKeys(params, ["count", "active", ...indexes.flatMap((i) => [`kind${i}`, `scale${i}`, `angle${i}`, `detail${i}`])])) return false;
  if (!exactKeys(points, indexes.map((i) => `object${i}`))) return false;
  if (!exactKeys(flags, ["grid", "measures", "edges", "vertices", "names"]) || !Object.values(flags).every((value) => typeof value === "boolean")) return false;
  for (const i of indexes) {
    const kind = params[`kind${i}`], point = points[`object${i}`];
    if (!number(kind, 0, 11, true) || !number(params[`scale${i}`], 0.5, 2) || !number(params[`angle${i}`], -36000, 36000) || !number(params[`detail${i}`], 0, SHAPE_KINDS[kind].life ? 1 : 0)) return false;
    if (!record(point) || !exactKeys(point, ["x", "y"]) || !number(point.x, 60, 900) || !number(point.y, 60, 660)) return false;
  }
  if (marks.length > 64 || new Set(marks).size !== marks.length) return false;
  return marks.every((mark) => {
    if (typeof mark !== "string") return false;
    const boundary = /^boundary\.([0-7])$/.exec(mark);
    if (boundary) return Number(boundary[1]) < params.count && SHAPE_KINDS[params[`kind${boundary[1]}`]].sides === 0;
    const part = /^(edge|vertex)\.([0-7])\.([0-3])$/.exec(mark);
    return !!part && Number(part[2]) < params.count && Number(part[3]) < SHAPE_KINDS[params[`kind${part[2]}`]].sides;
  });
}
