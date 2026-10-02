import type { PlanarState } from "../planar-kit/contract";
import { canPlaceCover, COVER_FLAGS, COVER_LIMIT, COVER_SCENE } from "./model";

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const exact = (x: Record<string, unknown>, keys: readonly string[]) => Object.keys(x).length === keys.length && keys.every((key) => Object.hasOwn(x, key));
const integer = (x: unknown, min: number, max: number): x is number => typeof x === "number" && Number.isInteger(x) && x >= min && x <= max;
function point(x: unknown): x is { x: number; y: number } { return record(x) && exact(x, ["x", "y"]) && integer(x.x, 0, 16) && integer(x.y, 0, 11); }
export function isValidCoverState(value: unknown): value is PlanarState {
  if (!record(value) || !exact(value, ["sceneId", "params", "points", "flags", "marks", "phase"]) || value.sceneId !== COVER_SCENE || value.phase !== 0 || !record(value.params) || !record(value.points) || !record(value.flags) || !Array.isArray(value.marks)) return false;
  const { params, points, flags, marks } = value;
  if (!exact(flags, COVER_FLAGS) || !Object.values(flags).every((flag) => typeof flag === "boolean") || flags.grid !== false || !integer(params.columns, 1, 12) || !integer(params.rows, 1, 12) || !integer(params.nextId, 0, 99999) || !integer(params.active, -1, 99998) || marks.length > params.columns * params.rows || new Set(marks).size !== marks.length) return false;
  if (marks.some((mark) => { if (typeof mark !== "string" || !/^missing\.(0|[1-9]\d?)_(0|[1-9]\d?)$/.test(mark)) return true; const [x, y] = mark.slice(8).split("_").map(Number); return x >= (params.columns as number) || y >= (params.rows as number); })) return false;
  const keys = Object.keys(params).filter((key) => /^angle\.(0|[1-9]\d{0,4})$/.test(key)), live: number[] = [], pointsKeys: string[] = [];
  if (keys.length > COVER_LIMIT) return false;
  for (const key of keys) {
    const id = Number(key.slice(6)), at = points[`piece.${id}`], home = points[`home.${id}`];
    if (id >= params.nextId || id > 99998 || ![0, 90].includes(params[key] as number) || !point(at) || !point(home) || at.x !== home.x || at.y !== home.y) return false;
    live.push(id); pointsKeys.push(`piece.${id}`, `home.${id}`);
  }
  if (!exact(params, ["columns", "rows", "nextId", "active", ...keys]) || !exact(points, pointsKeys) || params.active !== -1 && !live.includes(params.active)) return false;
  const state = value as unknown as PlanarState;
  return live.every((id) => canPlaceCover(state, { id, at: state.points[`piece.${id}`], angle: state.params[`angle.${id}`] }));
}
