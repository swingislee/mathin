import type { PlanarState } from "../planar-kit/contract";
import { gridPolygonCorners, isGridPolygon } from "./geometry";
import { GRID_COLUMNS, GRID_FLAGS, GRID_GLOBAL_PARAMS, GRID_POLYGON_PARAMS, GRID_ROWS, MAX_GRID_POLYGONS, MAX_GRID_VERTICES, MAX_UNIT_SQUARES } from "./model";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const number = (value: unknown, min: number, max: number, integer = false): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
function point(value: unknown, minX: number, maxX: number, minY: number, maxY: number, integer = false): value is { x: number; y: number } {
  return record(value) && exact(value, ["x", "y"]) && number(value.x, minX, maxX, integer) && number(value.y, minY, maxY, integer);
}

/** v2 精确键合同；草稿、面积缓存、像素比例及临时拖动帧不进入持久化。 */
export function isValidGridMeasureState(value: unknown): value is PlanarState {
  if (!record(value) || !exact(value, ["sceneId", "params", "points", "flags", "marks", "phase"]) || (value.sceneId !== "34-create" && value.sceneId !== "11-create") || value.phase !== 0
    || !record(value.params) || !record(value.points) || !record(value.flags) || !Array.isArray(value.marks) || value.marks.length !== 0) return false;
  const { params, points, flags } = value, lattice = value.sceneId === "34-create";
  if (!exact(flags, GRID_FLAGS) || !Object.values(flags).every((flag) => typeof flag === "boolean") || flags.grid !== false
    || !number(params.nextId, 1, 99999, true) || !number(params.active, -1, 99998, true) || !number(params.unit, 0, 2, true)) return false;
  const ids = Object.keys(params).flatMap((key) => /^kind\.(0|[1-9]\d{0,4})$/.test(key) ? [Number(key.slice(5))] : []);
  if (ids.some((id) => id >= (params.nextId as number) || id > 99998) || params.active !== -1 && !ids.includes(params.active)) return false;
  const parameterKeys: string[] = [...GRID_GLOBAL_PARAMS], pointKeys: string[] = [];
  let polygons = 0, vertices = 0, squares = 0;
  for (const id of ids) {
    const kind = params[`kind.${id}`];
    if (kind === 1) {
      if (lattice || ++squares > MAX_UNIT_SQUARES || !point(points[`tile.${id}`], -1, GRID_COLUMNS, -1, GRID_ROWS)) return false;
      parameterKeys.push(`kind.${id}`); pointKeys.push(`tile.${id}`); continue;
    }
    if (kind !== 0 || ++polygons > MAX_GRID_POLYGONS) return false;
    const count = params[`count.${id}`], split = params[`split.${id}`];
    if (!number(count, 3, 32, true) || (vertices += count) > MAX_GRID_VERTICES || !number(params[`base.${id}`], 0, count - 1, true)
      || !number(params[`apex.${id}`], 0, count - 1, true) || !number(split, 0, lattice ? 1 : 0, true)) return false;
    parameterKeys.push(...GRID_POLYGON_PARAMS.map((key) => `${key}.${id}`));
    const polygon = [];
    for (let i = 0; i < count; i++) {
      const key = `v.${id}.${i}`, vertex = points[key];
      if (!point(vertex, 0, GRID_COLUMNS, 0, GRID_ROWS, lattice)) return false;
      pointKeys.push(key); polygon.push(vertex);
    }
    if (!isGridPolygon(polygon)) return false;
    if (split) for (let i = 0; i < gridPolygonCorners(polygon).length - 2; i++) {
      const key = `part.${id}.${i}`;
      if (!point(points[key], -24, 24, -24, 24)) return false;
      pointKeys.push(key);
    }
  }
  return exact(params, parameterKeys) && exact(points, pointKeys);
}
