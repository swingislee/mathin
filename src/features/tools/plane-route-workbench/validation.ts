import type { PlanarState } from "../planar-kit/contract";
import { GRID_LIMIT, GRID_ROUTE_FLAGS, GRID_ROUTE_GLOBALS, GRID_ROUTE_SCENE, GRID_VISIT_LIMIT, ROUTE_LIMIT, gridStepAllowed, sameGridPoint } from "./grid-model";
import { REFLECTION_CONTACT_LIMIT, REFLECTION_POINT_LIMIT, REFLECTION_ROUTE_FLAGS, REFLECTION_ROUTE_GLOBALS, REFLECTION_ROUTE_SCENE } from "./reflection-model";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const number = (value: unknown, low: number, high: number, integer = false): value is number => typeof value === "number" && Number.isFinite(value) && value >= low && value <= high && (!integer || Number.isInteger(value));
const idPattern = "(0|[1-9]\\d{0,4})";

/** 两种用途分别限定字段和真实路线；显示结论从准确材料派生，保存中不接受缓存答案或隐式跨版本字段。 */
export function isValidRouteState(value: unknown): value is PlanarState {
  if (!record(value) || !exact(value, ["sceneId", "params", "points", "flags", "marks", "phase"]) || !record(value.params) || !record(value.points) || !record(value.flags) || !Array.isArray(value.marks) || !number(value.phase, 0, 1)) return false;
  const { params, points, flags, marks } = value;
  if (!number(params.nextId, 0, 99999, true) || !number(params.active, -1, 99998, true) || flags.grid !== false || Object.values(flags).some((flag) => typeof flag !== "boolean")) return false;
  const grid = value.sceneId === GRID_ROUTE_SCENE;
  if (!grid && value.sceneId !== REFLECTION_ROUTE_SCENE) return false;
  if (!exact(flags, grid ? GRID_ROUTE_FLAGS : REFLECTION_ROUTE_FLAGS)) return false;
  const keys: string[] = [...(grid ? GRID_ROUTE_GLOBALS : REFLECTION_ROUTE_GLOBALS)];
  const ids: number[] = [];
  let visits = 0;
  const candidatePattern = new RegExp(`^${grid ? "visits" : "contact"}\\.${idPattern}$`);
  for (const [key, candidate] of Object.entries(params)) {
    const match = candidatePattern.exec(key);
    if (!match) continue;
    const id = Number(match[1]);
    if (id >= params.nextId || id > 99998 || !number(candidate, grid ? 1 : -REFLECTION_CONTACT_LIMIT, grid ? GRID_VISIT_LIMIT : REFLECTION_CONTACT_LIMIT, grid)) return false;
    ids.push(id); keys.push(key);
    if (grid) visits += candidate;
  }
  if (ids.length > ROUTE_LIMIT || (ids.length ? !ids.includes(params.active) : params.active !== -1)) return false;
  if (!grid) {
    if (marks.length !== 0 || !exact(params, keys) || !exact(points, ["a", "b", "axis"]) || !number(params.axisAngle, -180, 180) || !number(params.viewX, -REFLECTION_POINT_LIMIT, REFLECTION_POINT_LIMIT) || !number(params.viewY, -REFLECTION_POINT_LIMIT, REFLECTION_POINT_LIMIT) || !number(params.viewSpan, 1, 20000)) return false;
    return Object.values(points).every((point) => record(point) && exact(point, ["x", "y"]) && number(point.x, -REFLECTION_POINT_LIMIT, REFLECTION_POINT_LIMIT) && number(point.y, -REFLECTION_POINT_LIMIT, REFLECTION_POINT_LIMIT));
  }
  if (!number(params.columns, 1, GRID_LIMIT, true) || !number(params.rows, 1, GRID_LIMIT, true) || !number(params.direction, 0, 1, true) || !number(params.numberStep, -1, (params.columns + 1) * (params.rows + 1) - 1, true) || visits > GRID_VISIT_LIMIT || marks.length !== visits || !exact(points, ["start", "end", "required"])) return false;
  for (const point of Object.values(points)) if (!record(point) || !exact(point, ["x", "y"]) || !number(point.x, 0, params.columns, true) || !number(point.y, 0, params.rows, true)) return false;
  for (let row = 0; row <= params.rows; row++) {
    const key = `h.${row}`;
    if (!number(params[key], 0, (1 << params.columns) - 1, true)) return false;
    keys.push(key);
  }
  for (let column = 0; column <= params.columns; column++) {
    const key = `v.${column}`;
    if (!number(params[key], 0, (1 << params.rows) - 1, true)) return false;
    keys.push(key);
  }
  if (!exact(params, keys)) return false;
  const stepPattern = new RegExp(`^visit\\.${idPattern}\\.(0|[1-9]\\d{0,2})\\.(0|[1-9]\\d?)_(0|[1-9]\\d?)$`);
  const routes = new Map<number, Map<number, { x: number; y: number }>>(ids.map((id) => [id, new Map()]));
  for (const mark of marks) {
    if (typeof mark !== "string") return false;
    const match = stepPattern.exec(mark);
    if (!match) return false;
    const id = Number(match[1]), step = Number(match[2]), x = Number(match[3]), y = Number(match[4]), route = routes.get(id);
    if (!route || route.has(step) || step >= (params[`visits.${id}`] as number) || x > params.columns || y > params.rows) return false;
    route.set(step, { x, y });
  }
  const state = value as unknown as PlanarState;
  for (const [id, route] of routes) {
    const count = params[`visits.${id}`] as number;
    if (route.size !== count || !route.get(0) || !sameGridPoint(route.get(0)!, state.points.start)) return false;
    for (let step = 1; step < count; step++) if (!route.get(step) || !gridStepAllowed(state, route.get(step - 1)!, route.get(step)!)) return false;
  }
  return true;
}
