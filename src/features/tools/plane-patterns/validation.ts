import type { PlanarState } from "../planar-kit/contract";
import { edgeKey, figureFromVertices, gridGraph, placeDomino, sceneGraph, triangleGraph, type Domino, type PlaneGraph } from "./model";

const numberIn = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const integerIn = (value: unknown, min: number, max: number) => numberIn(value, min, max) && Number.isInteger(value);
const pointValid = (state: PlanarState, key: string) => state.points[key] !== undefined && numberIn(state.points[key].x, -5000, 5000) && numberIn(state.points[key].y, -5000, 5000);
const records = (state: PlanarState, prefix: string) => state.marks.filter((mark) => mark.startsWith(`${prefix}.`)).map((mark) => mark.slice(prefix.length + 1).split(".").map((part) => part.replaceAll("_", ",")));

function graphRecordsValid(state: PlanarState, graph: PlaneGraph): boolean {
  const p = state.params, known = new Set(graph.points.map((point) => point.id)), isPath = state.sceneId === "52" || state.sceneId === "53", prefixes = isPath ? ["closed", "stroke", "through"] : ["closed", "figure", "pick"];
  if (state.marks.some((mark) => !prefixes.some((prefix) => mark.startsWith(`${prefix}.`)))) return false;
  const closed = records(state, "closed");
  if (closed.some((record) => record.length !== 2 || !graph.edges.some((edge) => edgeKey(edge.a, edge.b) === edgeKey(record[0], record[1])))) return false;
  const filtered = { ...graph, edges: graph.edges.filter((edge) => !closed.some(([a, b]) => edgeKey(a, b) === edgeKey(edge.a, edge.b))) };
  const selections = records(state, "pick");
  if (selections.length > 1 || selections.some((selection) => selection.length > (state.sceneId === "48" ? 3 : 2) || selection.some((id) => !known.has(id)))) return false;
  if (records(state, "figure").some((record) => !figureFromVertices(filtered, record, state.sceneId !== "47"))) return false;
  if (records(state, "stroke").some((stroke) => !stroke.length || stroke.some((id, i) => !known.has(id) || (i > 0 && !filtered.edges.some((edge) => edgeKey(edge.a, edge.b) === edgeKey(stroke[i - 1], id)))))) return false;
  const through = records(state, "through");
  if (through.length > 1 || through.some((record) => record.length !== 1 || !known.has(record[0]))) return false;
  return state.sceneId !== "53" || integerIn(p.numberStep, -1, graph.points.length - 1);
}
/** 校验图形与路径的真实边、动态对象数量和落点，保持课堂只读恢复安全。 */
export function isValidPlanePatternsState(state: PlanarState): boolean {
  const p = state.params;
  if (!numberIn(state.phase, 0, 1) || state.marks.length > 128 || state.marks.some((mark) => mark.length > 64) || Object.keys(p).length > 100 || Object.keys(state.points).length > 100) return false;
  switch (state.sceneId) {
    case "47": return graphRecordsValid(state, sceneGraph(state.flags.angles ? "angles" : "segments"));
    case "48": return integerIn(p.levels, 2, 4) && graphRecordsValid(state, triangleGraph(p.levels));
    case "49":
    case "53": return integerIn(p.columns, 2, 6) && integerIn(p.rows, 2, 4) && graphRecordsValid(state, gridGraph(p.columns, p.rows));
    case "52": return graphRecordsValid(state, sceneGraph("oneStroke"));
    case "51": return integerIn(p.count, 1, 48) && integerIn(p.selected, 0, p.count - 1) && Array.from({ length: p.count }, (_, index) => index).every((index) => pointValid(state, `match${index}`) && numberIn(p[`angle${index}`], -36000, 36000));
    case "57": {
      if (!integerIn(p.count, 0, 18) || !integerIn(p.selected, 0, Math.max(0, p.count - 1)) || state.marks.some((mark) => !/^missing\.[0-5]_[0-5]$/.test(mark))) return false;
      const removed = records(state, "missing").flat(), pieces: Domino[] = [];
      for (let index = 0; index < p.count; index++) {
        const location = state.points[`domino${index}`];
        if (!location || !integerIn(location.x, 0, 5) || !integerIn(location.y, 0, 5)) return false;
        const piece = { id: `domino-${index}`, column: location.x, row: location.y, vertical: state.flags[`vertical${index}`] ?? false };
        if (!placeDomino(piece, pieces, removed)) return false;
        pieces.push(piece);
      }
      return true;
    }
    default: return false;
  }
}
