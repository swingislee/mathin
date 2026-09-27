import type { PlanarState } from "../planar-kit/contract";
import { NETWORK_FLAGS, NETWORK_GLOBALS, NETWORK_LIMIT, networkAnglesEqual, networkEdgeKey, networkFigureValid, networkGraph, networkTopologyValid, type NetworkRecord, type NetworkRecordKind } from "./model";

const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const id = "(0|[1-9][0-9]{0,4})";
const nodeKey = new RegExp(`^node\\.${id}$`), edgeKey = new RegExp(`^[ab]\\.${id}$`), pickKey = new RegExp(`^pick\\.${id}\\.${id}$`), recordKey = new RegExp(`^(segment|angle|figure|stroke)\\.${id}\\.${id}\\.${id}$`);
export function isValidPlaneNetworkState(value: PlanarState): boolean {
  if (!plain(value) || Object.keys(value).sort().join("|") !== "flags|marks|params|phase|points|sceneId" || !["47-create", "52-create"].includes(value.sceneId)) return false;
  const { params, points, flags, marks, phase } = value;
  if (!plain(params) || !plain(points) || !plain(flags) || !Array.isArray(marks) || typeof phase !== "number" || !Number.isFinite(phase) || phase < 0 || phase > 1) return false;
  if (Object.keys(points).length > NETWORK_LIMIT || Object.keys(params).length > 204 || Object.keys(flags).sort().join("|") !== [...NETWORK_FLAGS].sort().join("|") || Object.values(flags).some((flag) => typeof flag !== "boolean") || marks.length > 320 || new Set(marks).size !== marks.length) return false;
  const nodes = new Set<number>(), edgeIds = new Set<number>();
  for (const [key, point] of Object.entries(points)) {
    const match = key.match(nodeKey);
    if (!match || !integer(Number(match[1]), 0, 99998) || !plain(point) || Object.keys(point).sort().join("|") !== "x|y" || typeof point.x !== "number" || !Number.isFinite(point.x) || point.x < -1000 || point.x > 2000 || typeof point.y !== "number" || !Number.isFinite(point.y) || point.y < -1000 || point.y > 1720) return false;
    nodes.add(Number(match[1]));
  }
  for (const [key, endpoint] of Object.entries(params)) {
    if ((NETWORK_GLOBALS as readonly string[]).includes(key)) continue;
    const match = key.match(edgeKey);
    if (!match || !integer(Number(match[1]), 0, 99998) || !integer(endpoint, 0, 99998) || !nodes.has(endpoint)) return false;
    edgeIds.add(Number(match[1]));
  }
  if (edgeIds.size > NETWORK_LIMIT || Object.keys(params).length !== NETWORK_GLOBALS.length + edgeIds.size * 2) return false;
  for (const key of ["nextNode", "nextEdge", "nextRecord", "nextStroke"] as const) if (!integer(params[key], 1, 99999)) return false;
  if ([...nodes].some((node) => node >= params.nextNode) || [...edgeIds].some((edge) => edge >= params.nextEdge) || !integer(params.activeNode, -1, 99998) || !integer(params.activeEdge, -1, 99998) || !integer(params.currentStroke, -1, 99998) || (params.activeNode !== -1 && !nodes.has(params.activeNode)) || (params.activeEdge !== -1 && !edgeIds.has(params.activeEdge))) return false;
  if (!integer(params.figureMode, 0, 2) || !integer(params.rays, 2, 8) || !integer(params.columns, 1, 5) || !integer(params.rows, 1, 4) || !integer(params.levels, 1, 4)) return false;
  for (const edge of edgeIds) if (!integer(params[`a.${edge}`], 0, 99998) || !integer(params[`b.${edge}`], 0, 99998) || params[`a.${edge}`] >= params[`b.${edge}`]) return false;
  const graph = networkGraph(value);
  if (!networkTopologyValid(graph)) return false;
  const picks = new Map<number, number>(), records = new Map<number, NetworkRecord & { steps: Map<number, number> }>();
  for (const mark of marks) {
    if (typeof mark !== "string" || mark.length > 64) return false;
    const pick = mark.match(pickKey), record = mark.match(recordKey);
    if (pick) {
      const index = Number(pick[1]), node = Number(pick[2]);
      if (value.sceneId !== "47-create" || index >= (params.figureMode === 0 ? 2 : params.figureMode === 1 ? 3 : 12) || !nodes.has(node) || picks.has(index) || [...picks.values()].includes(node)) return false;
      picks.set(index, node); continue;
    }
    if (!record) return false;
    const kind = record[1] as NetworkRecordKind, recordId = Number(record[2]), step = Number(record[3]), node = Number(record[4]);
    if (!integer(recordId, 0, 99998) || !nodes.has(node) || recordId >= params[kind === "stroke" ? "nextStroke" : "nextRecord"] || (value.sceneId === "52-create" ? kind !== "stroke" : kind === "stroke")) return false;
    const entry = records.get(recordId) ?? { kind, id: recordId, nodes: [], steps: new Map() };
    if (entry.kind !== kind || entry.steps.has(step)) return false;
    entry.steps.set(step, node); records.set(recordId, entry);
  }
  if ([...picks.keys()].some((index) => index >= picks.size) || records.size > (value.sceneId === "52-create" ? 32 : 24)) return false;
  const edges = new Set(graph.edges.map((edge) => networkEdgeKey(edge.a, edge.b))), traversed = new Set<string>();
  const angles: number[][] = [];
  let visits = 0;
  for (const record of [...records.values()].sort((a, b) => a.id - b.id)) {
    if ([...record.steps.keys()].some((step) => step >= record.steps.size)) return false;
    record.nodes = [...record.steps].sort((a, b) => a[0] - b[0]).map(([, node]) => node);
    if (record.kind === "stroke") {
      visits += record.nodes.length;
      if (visits > 192) return false;
      for (let i = 1; i < record.nodes.length; i++) { const key = networkEdgeKey(record.nodes[i - 1], record.nodes[i]); if (!edges.has(key) || (!flags.repeat && traversed.has(key))) return false; traversed.add(key); }
    } else {
      if (!networkFigureValid(graph, record.kind, record.nodes)) return false;
      if (record.kind === "angle") { if (angles.some((nodes) => networkAnglesEqual(graph, nodes, record.nodes))) return false; angles.push(record.nodes); }
    }
  }
  return value.sceneId === "47-create" ? params.currentStroke === -1 : params.currentStroke === -1 || records.has(params.currentStroke);
}
