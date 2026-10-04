import type { PlanarState } from "../planar-kit/contract";
import { isSimpleConstructionPolygon } from "../plane-construction/model";
import { buildPaperLayers, cutIntersectsLayers, distance, paperCuts, paperVertices } from "./geometry";

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: readonly string[]) => Object.keys(v).length === expected.length && expected.every((key) => Object.hasOwn(v, key));
const number = (v: unknown, min: number, max: number, integer = false): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v));
export function validCutPolygon(poly: readonly { x: number; y: number }[]) {
  return isSimpleConstructionPolygon(poly) && Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x)) <= 1600 && Math.max(...poly.map((p) => p.y)) - Math.min(...poly.map((p) => p.y)) <= 1600;
}
export function isValidPaperLayersState(state: PlanarState): boolean {
  if (!record(state) || !keys(state, ["sceneId", "params", "points", "flags", "marks", "phase"]) || state.sceneId !== "32-layers" || state.phase !== 0 || !record(state.params) || !record(state.points) || !record(state.flags) || !Array.isArray(state.marks) || state.marks.length) return false;
  const { params: p, points: q, flags: f } = state;
  if (Object.keys(p).length > 256 || Object.keys(q).length > 256 || !number(p.paperCount, 3, 32, true) || !number(p.foldCount, 0, 2, true) || !number(p.activeFold, p.foldCount ? 0 : -1, p.foldCount - 1, true)
    || !number(p.nextCutId, 1, 99999, true) || !number(p.activeCut, -1, 99998, true) || !number(p.activeVertex, 0, 31, true) || !keys(f, ["grid", "measures", "crease", "edit", "editCut"]) || !Object.values(f).every((v) => typeof v === "boolean")) return false;
  const pkeys = ["paperCount", "foldCount", "activeFold", "nextCutId", "activeCut", "activeVertex"], qkeys = Array.from({ length: p.paperCount }, (_, i) => `paper.${i}`);
  for (let i = 0; i < p.foldCount; i++) {
    pkeys.push(`foldAngle.${i}`, `foldSide.${i}`); qkeys.push(`foldA.${i}`, `foldB.${i}`);
    if (!number(p[`foldAngle.${i}`], 0, 180) || ![-1, 1].includes(p[`foldSide.${i}`]) || i > 0 && p[`foldAngle.${i}`] > 0 && p[`foldAngle.${i - 1}`] !== 180) return false;
  }
  const ids = Object.keys(p).flatMap((key) => /^cutKind\.(0|[1-9]\d{0,4})$/.test(key) ? [Number(key.slice(8))] : []);
  if (ids.length > 12 || ids.some((id) => id >= p.nextCutId) || p.activeCut !== -1 && !ids.includes(p.activeCut) || p.activeCut === -1 && p.activeVertex !== 0) return false;
  let total = 0;
  for (const id of ids) {
    const kind = p[`cutKind.${id}`], n = p[`cutVertices.${id}`];
    if (!number(kind, 0, 1, true) || !number(n, kind ? 3 : 1, kind ? 32 : 1, true) || !number(p[`cutRadius.${id}`], kind ? 0 : 3, kind ? 0 : 350) || !number(p[`cutDepth.${id}`], 1, p.foldCount, true)) return false;
    total += n; if (total > 192 || id === p.activeCut && p.activeVertex >= n) return false;
    pkeys.push(`cutKind.${id}`, `cutVertices.${id}`, `cutRadius.${id}`, `cutDepth.${id}`);
    for (let j = 0; j < n; j++) qkeys.push(`cut.${id}.${j}`);
  }
  if (!keys(p, pkeys) || !keys(q, qkeys)) return false;
  for (const [key, at] of Object.entries(q)) {
    const paper = key.startsWith("paper.");
    if (!record(at) || !keys(at, ["x", "y"]) || !number(at.x, paper ? 0 : -5000, paper ? 960 : 5000) || !number(at.y, paper ? 0 : -5000, paper ? 720 : 5000)) return false;
  }
  if (!isSimpleConstructionPolygon(paperVertices(state))) return false;
  for (let i = 0; i < p.foldCount; i++) if (distance(q[`foldA.${i}`], q[`foldB.${i}`]) < 12) return false;
  const { layers, splitAreas } = buildPaperLayers(state), cuts = paperCuts(state);
  if (splitAreas.some((areas) => areas.some((area) => area <= 1)) || new Set(cuts.map((cut) => JSON.stringify([cut.kind, cut.depth, cut.radius, cut.points.map((point) => [point.x, point.y])]))).size !== cuts.length) return false;
  return cuts.every((cut) => (cut.kind === "circle" || validCutPolygon(cut.points)) && cutIntersectsLayers(cut, layers));
}
