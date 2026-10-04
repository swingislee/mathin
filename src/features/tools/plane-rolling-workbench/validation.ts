import type { PlanarState } from "../planar-kit/contract";
import { ROLLING_ANGLE_LIMIT, ROLLING_FLAGS, ROLLING_GLOBALS, ROLLING_LIMIT, ROLLING_OBSERVATIONS, ROLLING_PARAMS, ROLLING_RADIUS_MAX, ROLLING_RADIUS_MIN, ROLLING_SCENE } from "./constants";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const number = (value: unknown, min: number, max: number, integer = false): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));

/** 圆对只保存独立几何与观察意图；圆心轨道、自转和接触点由无滑动关系派生。 */
export function isValidRollingWorkbenchState(value: unknown): value is PlanarState {
  if (!record(value) || !exact(value, ["sceneId", "params", "points", "flags", "marks", "phase"]) || value.sceneId !== ROLLING_SCENE
    || value.phase !== 0 || !record(value.params) || !record(value.points) || !record(value.flags) || !Array.isArray(value.marks) || value.marks.length !== 0) return false;
  const { params, points, flags } = value;
  if (!number(params.nextId, 0, 99999, true) || !number(params.active, -1, 99998, true) || !number(params.rollBy, -36000, 36000)
    || !number(params.viewX, -1000, 1000) || !number(params.viewY, -1000, 1000) || !number(params.viewSpan, 1, 20000) || flags.grid !== false) return false;
  const keys = Object.keys(params).filter((key) => /^R\.(0|[1-9]\d{0,4})$/.test(key)), ids = keys.map((key) => Number(key.slice(2)));
  if (ids.length > ROLLING_LIMIT || (ids.length ? !ids.includes(params.active) : params.active !== -1)) return false;
  const paramKeys: string[] = [...ROLLING_GLOBALS], pointKeys: string[] = [], flagKeys: string[] = [...ROLLING_FLAGS];
  for (const id of ids) {
    const R = params[`R.${id}`], r = params[`r.${id}`], center = points[`center.${id}`];
    if (id >= params.nextId || id > 99998 || !number(R, ROLLING_RADIUS_MIN, ROLLING_RADIUS_MAX) || !number(r, ROLLING_RADIUS_MIN, ROLLING_RADIUS_MAX)
      || !number(params[`angle.${id}`], -ROLLING_ANGLE_LIMIT, ROLLING_ANGLE_LIMIT) || flags[`inside.${id}`] === true && r >= R
      || !record(center) || !exact(center, ["x", "y"]) || !number(center.x, -1000, 1000) || !number(center.y, -1000, 1000)) return false;
    paramKeys.push(...ROLLING_PARAMS.map((key) => `${key}.${id}`)); pointKeys.push(`center.${id}`); flagKeys.push(...ROLLING_OBSERVATIONS.map((key) => `${key}.${id}`));
  }
  return exact(params, paramKeys) && exact(points, pointKeys) && exact(flags, flagKeys) && Object.values(flags).every((flag) => typeof flag === "boolean");
}
