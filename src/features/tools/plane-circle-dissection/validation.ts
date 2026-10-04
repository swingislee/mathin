import type { PlanarState } from "../planar-kit/contract";

export const CIRCLE_DISSECTION_SCENE = "27-sectors";
export const CIRCLE_COUNTS = [8, 16, 32, 64] as const;
const keys = (object: unknown, expected: string[]) => !!object && typeof object === "object" && !Array.isArray(object)
  && Object.keys(object).length === expected.length && expected.every((key) => Object.hasOwn(object, key));
const number = (value: unknown, low: number, high: number) => typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;

export function isValidCircleDissectionState(state: PlanarState | undefined): state is PlanarState {
  if (!state || !keys(state, ["sceneId", "params", "points", "flags", "marks", "phase"]) || state.sceneId !== CIRCLE_DISSECTION_SCENE
    || !state.params || !state.points || state.phase !== 0 || !Array.isArray(state.marks) || state.marks.length
    || !keys(state.flags, ["grid", "measures", "original", "snap", "names"]) || Object.values(state.flags).some((value) => typeof value !== "boolean")) return false;
  const { count, radius, active } = state.params;
  if (!(CIRCLE_COUNTS as readonly number[]).includes(count) || !number(radius, 0.5, 3) || !Number.isInteger(active) || active < -1 || active >= count) return false;
  const parameters = ["count", "radius", "active"], points: string[] = [];
  for (let i = 0; i < count; i++) {
    parameters.push(`turn.${i}`); points.push(`sector.${i}`);
    const at = state.points[`sector.${i}`];
    if (!number(state.params[`turn.${i}`], -36000, 36000) || !keys(at, ["x", "y"]) || !number(at.x, -20, 20) || !number(at.y, -12, 12)) return false;
  }
  return keys(state.params, parameters) && keys(state.points, points);
}
