import type { PlanarState } from "../planar-kit/contract";
import { MATCH_FLAGS, MATCH_LIMIT, MATCH_SCENE } from "./model";

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const exact = (x: Record<string, unknown>, keys: readonly string[]) => Object.keys(x).length === keys.length && keys.every((key) => Object.hasOwn(x, key));
const number = (x: unknown, min: number, max: number, int = false): x is number => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max && (!int || Number.isInteger(x));
/** 活材料与教师留影分别校验；删棒不会改写参考现场，空舞台也是合法起点。 */
export function isValidMatchState(value: unknown): value is PlanarState {
  if (!record(value) || !exact(value, ["sceneId", "params", "points", "flags", "marks", "phase"]) || value.sceneId !== MATCH_SCENE || value.phase !== 0 || !record(value.params) || !record(value.points) || !record(value.flags) || !Array.isArray(value.marks) || value.marks.length !== 0) return false;
  const { params, points, flags } = value;
  if (!exact(flags, MATCH_FLAGS) || !Object.values(flags).every((flag) => typeof flag === "boolean") || !number(params.nextId, 0, 99999, true) || !number(params.active, -1, 99998, true) || !number(params.turn, -360, 360)) return false;
  const paramsKeys = ["nextId", "active", "turn"], pointsKeys: string[] = [];
  const live: number[] = [];
  for (const prefix of ["angle", "referenceAngle"]) {
    const keys = Object.keys(params).filter((key) => new RegExp(`^${prefix}\\.(0|[1-9]\\d{0,4})$`).test(key));
    if (keys.length > MATCH_LIMIT) return false;
    for (const key of keys) {
      const id = Number(key.slice(prefix.length + 1)), pointKey = `${prefix === "angle" ? "stick" : "reference"}.${id}`, point = points[pointKey];
      if (id >= params.nextId || id > 99998 || !number(params[key], -36000, 36000) || !record(point) || !exact(point, ["x", "y"]) || !number(point.x, 40, 920) || !number(point.y, 40, 680)) return false;
      paramsKeys.push(key); pointsKeys.push(pointKey);
      if (prefix === "angle") live.push(id);
    }
  }
  return (params.active === -1 || live.includes(params.active)) && exact(params, paramsKeys) && exact(points, pointsKeys);
}
