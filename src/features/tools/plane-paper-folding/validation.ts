import type { PlanarState } from "../planar-kit/contract";
import { isSimpleConstructionPolygon } from "../plane-construction/model";
import { MAX_CUT_POINTS, MAX_PAPER_CUTS, PAPER_FOLDING_SCENE, creaseSplitsPaper, cutIntersectsPaper, paperCuts, paperVertices } from "./model";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
const numeric = (value: unknown, min: number, max: number, integer = false): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
export function isValidPaperFoldingState(state: PlanarState): boolean {
  if (!record(state) || !keys(state, ["sceneId", "params", "points", "flags", "marks", "phase"]) || state.sceneId !== PAPER_FOLDING_SCENE || !numeric(state.phase, 0, 1)
    || !record(state.params) || !record(state.points) || !record(state.flags) || !Array.isArray(state.marks) || state.marks.length) return false;
  const { params, points, flags } = state;
  if (!numeric(params.paperCount, 3, 32, true) || !numeric(params.creaseSet, 0, 1, true) || ![-1, 1].includes(params.side) || !numeric(params.cutCount, 0, MAX_PAPER_CUTS, true)
    || !keys(flags, ["grid", "measures", "crease", "edit"]) || !Object.values(flags).every((value) => typeof value === "boolean") || (!params.creaseSet && (state.phase !== 0 || params.cutCount > 0))) return false;
  const parameterKeys = ["paperCount", "creaseSet", "side", "cutCount"], pointKeys = ["creaseA", "creaseB", ...Array.from({ length: params.paperCount }, (_, i) => `paper.${i}`)];
  let total = 0;
  for (let i = 0; i < params.cutCount; i++) {
    const kind = params[`cutKind.${i}`], count = params[`cutVertices.${i}`], radius = params[`cutRadius.${i}`];
    if (!numeric(kind, 0, 1, true) || !numeric(count, kind === 0 ? 1 : 3, kind === 0 ? 1 : 32, true) || !numeric(radius, kind === 0 ? 3 : 0, kind === 0 ? 350 : 0)) return false;
    total += count; if (total > MAX_CUT_POINTS) return false;
    parameterKeys.push(`cutKind.${i}`, `cutVertices.${i}`, `cutRadius.${i}`);
    for (let j = 0; j < count; j++) pointKeys.push(`cut.${i}.${j}`);
  }
  if (!keys(params, parameterKeys) || !keys(points, pointKeys)) return false;
  for (const [key, point] of Object.entries(points)) {
    if (!record(point) || !keys(point, ["x", "y"])) return false;
    const crease = key === "creaseA" || key === "creaseB";
    if (!numeric(point.x, crease ? -960 : 0, crease ? 1920 : 960) || !numeric(point.y, crease ? -720 : 0, crease ? 1440 : 720)) return false;
  }
  if (Math.hypot(points.creaseA.x - points.creaseB.x, points.creaseA.y - points.creaseB.y) < 12 || !isSimpleConstructionPolygon(paperVertices(state)) || params.creaseSet && !creaseSplitsPaper(state)) return false;
  const cuts = paperCuts(state);
  if (new Set(cuts.map((cut) => JSON.stringify(cut))).size !== cuts.length) return false;
  return cuts.every((cut) => (cut.kind === "circle" || isSimpleConstructionPolygon(cut.points)) && cutIntersectsPaper(state, cut));
}
