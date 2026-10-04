import type { PlanarState } from "../planar-kit/contract";

export const LINE_SCENE = "03-create", LINE_LIMIT = 16, LINE_BOUND = 4000, LINE_UNIT = 40;
const ownKeys = (value: unknown, keys: readonly string[]) => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
const number = (value: number, low: number, high: number, integer = false) => Number.isFinite(value) && value >= low && value <= high && (!integer || Number.isInteger(value));

/** 各材料有独立的三个控制点；无限线、垂足和角弧由真实点位派生。 */
export function isValidLinesState(state: PlanarState | undefined): state is PlanarState {
  if (!state || !ownKeys(state, ["sceneId", "params", "points", "flags", "marks", "phase"]) || state.sceneId !== LINE_SCENE
    || state.phase !== 0 || !Array.isArray(state.marks) || state.marks.length !== 0) return false;
  const p = state.params;
  if (!p || !number(p.count, 0, LINE_LIMIT, true) || !number(p.active, p.count ? 0 : -1, p.count - 1, true) || !number(p.vertex, 0, 2, true)) return false;
  const paramKeys = ["count", "active", "vertex"], pointKeys: string[] = [];
  if (!ownKeys(state.flags, ["grid", "measures", "names", "detour", "foot"]) || Object.values(state.flags).some((value) => typeof value !== "boolean")) return false;
  for (let id = 0; id < p.count; id++) {
    paramKeys.push(`kind.${id}`, `q.${id}`);
    if (!number(p[`kind.${id}`], 0, 6, true) || !number(p[`q.${id}`], -LINE_BOUND, LINE_BOUND)) return false;
    for (const name of ["a", "b", "c"]) {
      const key = `${name}.${id}`, at = state.points?.[key]; pointKeys.push(key);
      if (!ownKeys(at, ["x", "y"]) || !number(at.x, -LINE_BOUND, LINE_BOUND) || !number(at.y, -LINE_BOUND, LINE_BOUND)) return false;
    }
    const a = state.points[`a.${id}`], b = state.points[`b.${id}`], c = state.points[`c.${id}`], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1 || (p[`kind.${id}`] === 3 && Math.hypot(c.x - a.x, c.y - a.y) < 1)
      || (p[`kind.${id}`] === 4 && (length < 40 || length > 400))) return false;
  }
  return ownKeys(p, paramKeys) && ownKeys(state.points, pointKeys);
}
