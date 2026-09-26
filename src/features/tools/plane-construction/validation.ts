import type { PlanarState } from "../planar-kit/contract";
import { constructionObject, isValidConstructionObject, parseConstructionTarget } from "./model";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const number = (value: unknown, min: number, max: number, integer = false): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
const objectParams = ["kind", "count", "angle", "rx", "ry", "life", "detail", "flip"];
const globalParams = ["nextId", "active", "dx", "dy", "turn", "axisAngle"];
const flagKeys = ["grid", "measures", "edges", "vertices", "names", "counts", "ghost", "edit", "snap"];

/** v2 存档只保存真实材料；反射过程中临时 frameA/B/C/D 基不能写入数学现场。 */
export function isValidConstructionState(state: PlanarState): boolean {
  if (!record(state) || !exactKeys(state, ["sceneId", "params", "points", "flags", "marks", "phase"]) || !["01-create", "20-create"].includes(state.sceneId) || state.phase !== 0) return false;
  if (!record(state.params) || !record(state.points) || !record(state.flags) || !Array.isArray(state.marks)) return false;
  const { params, points, flags, marks } = state;
  if (!number(params.nextId, 1, 99999, true) || !number(params.active, -1, 99998, true)
    || !number(params.dx, -600, 600) || !number(params.dy, -600, 600) || !number(params.turn, -360, 360) || !number(params.axisAngle, -180, 180)) return false;
  const ids = Object.keys(params).flatMap((key) => /^kind\.(0|[1-9]\d{0,4})$/.test(key) ? [Number(key.slice(5))] : []);
  if (ids.length > 16 || ids.some((id) => id >= params.nextId || id > 99998) || params.active !== -1 && !ids.includes(params.active)) return false;
  if (!exactKeys(params, [...globalParams, ...ids.flatMap((id) => objectParams.map((key) => `${key}.${id}`))])) return false;
  if (!exactKeys(flags, flagKeys) || !Object.values(flags).every((value) => typeof value === "boolean")) return false;
  const vertexKeys: string[] = [];
  for (const id of ids) {
    const kind = params[`kind.${id}`], count = params[`count.${id}`];
    if (!number(kind, 0, 3, true) || !number(count, kind >= 2 ? 0 : kind === 1 ? 4 : 3, kind >= 2 ? 0 : kind === 1 ? 4 : 32, true)) return false;
    for (let index = 0; index < count; index++) vertexKeys.push(`vertex.${id}.${index}`);
  }
  if (vertexKeys.length > 192 || Object.keys(points).length > 256 || !exactKeys(points, ["pivot", "axis", ...ids.map((id) => `center.${id}`), ...vertexKeys])) return false;
  for (const [key, point] of Object.entries(points)) {
    if (!record(point) || !exactKeys(point, ["x", "y"])) return false;
    const local = key.startsWith("vertex.");
    if (!number(point.x, local ? -800 : -1000, local ? 800 : 2000) || !number(point.y, local ? -800 : -1000, local ? 800 : 1720)) return false;
  }
  for (const id of ids) {
    const object = constructionObject(state, id);
    if (!object || !isValidConstructionObject(object)) return false;
  }
  if (marks.length > 128 || new Set(marks).size !== marks.length) return false;
  return marks.every((mark) => {
    if (typeof mark !== "string") return false;
    const target = parseConstructionTarget(mark);
    if (!target || target.id === undefined || !ids.includes(target.id)) return false;
    const kind = params[`kind.${target.id}`], count = params[`count.${target.id}`];
    if (target.type === "boundary") return kind >= 2;
    return (target.type === "edge" || target.type === "vertex") && kind < 2 && target.part !== undefined && target.part < count;
  });
}
