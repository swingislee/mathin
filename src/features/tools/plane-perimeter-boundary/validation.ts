import type { PlanarState } from "../planar-kit/contract";
import { constructionObject, constructionObjects } from "../plane-construction/model";
import { isValidPerimeterState } from "../plane-perimeter/validation";
import { BOUNDARY_FLAGS, MAX_EDGE_OFFSET, PERIMETER_BOUNDARY_SCENE, perimeterBaseState } from "./state";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
const number = (value: unknown, min: number, max: number, integer = false): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
export function isValidPerimeterBoundaryState(state: PlanarState): boolean {
  if (!record(state) || state.sceneId !== PERIMETER_BOUNDARY_SCENE || !record(state.params) || !record(state.points) || !record(state.flags)
    || Object.keys(state.params).length > 256 || Object.keys(state.points).length > 256 || !number(state.params.edgeSource, -1, 99998, true) || !number(state.params.edgeActive, -1, 31, true)) return false;
  const base = perimeterBaseState(state); if (!isValidPerimeterState(base)) return false;
  const ids = constructionObjects(base).map((object) => object.id), source = constructionObject(base, state.params.edgeSource);
  if (state.params.edgeSource !== -1 && !source || !source && state.params.edgeActive !== -1 || source && (state.params.edgeActive < 0 || state.params.edgeActive >= source.vertices.length)) return false;
  if (!keys(state.params, [...Object.keys(base.params), "edgeSource", "edgeActive", ...ids.map((id) => `unionMember.${id}`)])
    || ids.some((id) => !number(state.params[`unionMember.${id}`], 0, 1, true))
    || !keys(state.flags, [...Object.keys(base.flags), ...BOUNDARY_FLAGS]) || BOUNDARY_FLAGS.some((flag) => typeof state.flags[flag] !== "boolean")) return false;
  const offsets = Array.from({ length: source?.vertices.length ?? 0 }, (_, i) => `edgeMove.${i}`);
  if (!keys(state.points, [...Object.keys(base.points), ...offsets])) return false;
  return offsets.every((key) => { const point = state.points[key]; return record(point) && keys(point, ["x", "y"]) && number(point.x, -MAX_EDGE_OFFSET, MAX_EDGE_OFFSET) && number(point.y, -MAX_EDGE_OFFSET, MAX_EDGE_OFFSET); });
}
