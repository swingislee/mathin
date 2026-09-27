import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { appendPath, gridGraph, triangleGraph, type PlaneGraph } from "../plane-patterns/model";

export const NETWORK_EPSILON = 1e-6;
export const NETWORK_LIMIT = 96;
export const NETWORK_GLOBALS = ["nextNode", "nextEdge", "nextRecord", "nextStroke", "activeNode", "activeEdge", "currentStroke", "figureMode", "rays", "columns", "rows", "levels"] as const;
export const NETWORK_FLAGS = ["grid", "measures", "names", "degrees", "intersections", "edit", "snap", "repeat", "highlights"] as const;
export type NetworkSceneId = "47-create" | "52-create";
export interface NetworkNode extends PlanarPoint { id: number }
export interface NetworkEdge { id: number; a: number; b: number }
export interface NetworkGraph { nodes: NetworkNode[]; edges: NetworkEdge[]; nextNode: number; nextEdge: number }
export type NetworkRecordKind = "segment" | "angle" | "figure" | "stroke";
export interface NetworkRecord { kind: NetworkRecordKind; id: number; nodes: number[] }
export type NetworkMaterial = "segment" | "rays" | "triangle" | "grid";
export const networkDistance = (a: PlanarPoint, b: PlanarPoint) => Math.hypot(a.x - b.x, a.y - b.y);
export const networkEdgeKey = (a: number, b: number) => `${Math.min(a, b)}.${Math.max(a, b)}`;
export const networkCross = (a: PlanarPoint, b: PlanarPoint, c: PlanarPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const idPattern = "(0|[1-9][0-9]{0,4})";
const targetPattern = new RegExp(`^(node|edge)\\.${idPattern}$`);
export function parseNetworkTarget(target: string | null) {
  const match = target?.match(targetPattern);
  return match && Number(match[2]) <= 99998 ? { kind: match[1] as "node" | "edge", id: Number(match[2]) } : null;
}
export function createNetworkState(sceneId: NetworkSceneId): PlanarState {
  return {
    sceneId, params: { nextNode: 2, nextEdge: 1, nextRecord: 1, nextStroke: 1, activeNode: -1, activeEdge: -1, currentStroke: -1, figureMode: 0, rays: 5, columns: 3, rows: 2, levels: 3, "a.0": 0, "b.0": 1 },
    points: { "node.0": { x: 280, y: 360 }, "node.1": { x: 600, y: 360 } },
    flags: Object.fromEntries(NETWORK_FLAGS.map((key) => [key, key === "intersections" || key === "highlights"])), marks: [], phase: 1,
  };
}
export function networkGraph(state: PlanarState): NetworkGraph {
  return {
    nodes: Object.entries(state.points).map(([key, point]) => ({ ...point, id: Number(key.slice(5)) })).sort((a, b) => a.id - b.id),
    edges: Object.keys(state.params).filter((key) => key.startsWith("a.")).map((key) => ({ id: Number(key.slice(2)), a: state.params[key], b: state.params[`b.${key.slice(2)}`] })).sort((a, b) => a.id - b.id),
    nextNode: state.params.nextNode, nextEdge: state.params.nextEdge,
  };
}
export function networkAsPlaneGraph(graph: NetworkGraph): PlaneGraph {
  return { points: graph.nodes.map((node) => ({ ...node, id: String(node.id) })), edges: graph.edges.map((edge) => ({ a: String(edge.a), b: String(edge.b) })) };
}
export function networkDegree(graph: NetworkGraph, nodeId: number): number {
  return graph.edges.filter((edge) => edge.a === nodeId || edge.b === nodeId).length;
}
export function networkPointOnSegment(point: PlanarPoint, a: PlanarPoint, b: PlanarPoint, interior = false): boolean {
  const length = networkDistance(a, b);
  if (length <= NETWORK_EPSILON) return false;
  const projected = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length;
  return Math.abs(networkCross(a, b, point)) <= NETWORK_EPSILON * length && (interior ? projected > NETWORK_EPSILON && projected < length - NETWORK_EPSILON : projected >= -NETWORK_EPSILON && projected <= length + NETWORK_EPSILON);
}
export function networkIntersection(a: PlanarPoint, b: PlanarPoint, c: PlanarPoint, d: PlanarPoint): PlanarPoint | null {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * rx, y: a.y + t * ry };
}
export function networkTopologyValid(graph: NetworkGraph): boolean {
  const lookup = new Map(graph.nodes.map((node) => [node.id, node]));
  for (let i = 0; i < graph.nodes.length; i++) for (let j = i + 1; j < graph.nodes.length; j++) if (networkDistance(graph.nodes[i], graph.nodes[j]) <= NETWORK_EPSILON) return false;
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    const a = lookup.get(edge.a), b = lookup.get(edge.b), key = networkEdgeKey(edge.a, edge.b);
    if (!a || !b || edge.a >= edge.b || seen.has(key) || networkDistance(a, b) <= NETWORK_EPSILON) return false;
    seen.add(key);
    if (graph.nodes.some((node) => node.id !== a.id && node.id !== b.id && networkPointOnSegment(node, a, b))) return false;
  }
  for (let i = 0; i < graph.edges.length; i++) for (let j = i + 1; j < graph.edges.length; j++) {
    const a = graph.edges[i], b = graph.edges[j];
    if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) continue;
    if (networkIntersection(lookup.get(a.a)!, lookup.get(a.b)!, lookup.get(b.a)!, lookup.get(b.b)!)) return false;
  }
  return true;
}

/** 交点属于图本身；相交线、线内节点和重合线在同一操作里统一分裂、去重。 */
export function normalizeNetwork(source: NetworkGraph): { graph: NetworkGraph; remap: Map<number, number> } | null {
  let nextNode = source.nextNode, nextEdge = source.nextEdge;
  const nodes: NetworkNode[] = [], remap = new Map<number, number>();
  for (const node of [...source.nodes].sort((a, b) => a.id - b.id)) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || node.x < -1000 || node.x > 2000 || node.y < -1000 || node.y > 1720) return null;
    const same = nodes.find((other) => networkDistance(node, other) <= NETWORK_EPSILON);
    remap.set(node.id, same?.id ?? node.id);
    if (!same) nodes.push({ ...node });
  }
  const originalKeys = new Set<string>();
  const sources = [...source.edges].sort((a, b) => a.id - b.id).flatMap((edge) => {
    const a = remap.get(edge.a), b = remap.get(edge.b);
    if (a === undefined || b === undefined || a === b) return [];
    const key = networkEdgeKey(a, b);
    if (originalKeys.has(key)) return [];
    originalKeys.add(key);
    return [{ id: edge.id, a: Math.min(a, b), b: Math.max(a, b) }];
  });
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  for (let i = 0; i < sources.length; i++) for (let j = i + 1; j < sources.length; j++) {
    const first = sources[i], second = sources[j];
    const point = networkIntersection(lookup.get(first.a)!, lookup.get(first.b)!, lookup.get(second.a)!, lookup.get(second.b)!);
    if (!point || nodes.some((node) => networkDistance(node, point) <= NETWORK_EPSILON)) continue;
    if (nodes.length >= NETWORK_LIMIT || nextNode >= 99999) return null;
    const node = { ...point, id: nextNode++ };
    nodes.push(node); lookup.set(node.id, node);
  }
  const edges: NetworkEdge[] = [], keys = new Set<string>();
  for (const edge of sources) {
    const a = lookup.get(edge.a)!, b = lookup.get(edge.b)!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const ordered = nodes.filter((node) => networkPointOnSegment(node, a, b)).sort((c, d) => (c.x - d.x) * dx + (c.y - d.y) * dy);
    let reused = false;
    for (let i = 1; i < ordered.length; i++) {
      const left = ordered[i - 1].id, right = ordered[i].id, key = networkEdgeKey(left, right);
      if (keys.has(key)) continue;
      if (edges.length >= NETWORK_LIMIT || (reused && nextEdge >= 99999)) return null;
      keys.add(key); edges.push({ id: reused ? nextEdge++ : edge.id, a: Math.min(left, right), b: Math.max(left, right) }); reused = true;
    }
  }
  const graph = { nodes: nodes.sort((a, b) => a.id - b.id), edges: edges.sort((a, b) => a.id - b.id), nextNode, nextEdge };
  return nodes.length <= NETWORK_LIMIT && networkTopologyValid(graph) ? { graph, remap } : null;
}
export function networkCoveredNodes(graph: NetworkGraph, from: number, to: number): number[] | null {
  const a = graph.nodes.find((node) => node.id === from), b = graph.nodes.find((node) => node.id === to);
  if (!a || !b || from === to) return null;
  const ordered = graph.nodes.filter((node) => networkPointOnSegment(node, a, b)).sort((c, d) => (c.x - d.x) * (b.x - a.x) + (c.y - d.y) * (b.y - a.y));
  if (ordered[0]?.id !== from || ordered.at(-1)?.id !== to) return null;
  const edges = new Set(graph.edges.map((edge) => networkEdgeKey(edge.a, edge.b)));
  return ordered.every((node, index) => index === 0 || edges.has(networkEdgeKey(ordered[index - 1].id, node.id))) ? ordered.map((node) => node.id) : null;
}
export function networkSimplePolygon(points: readonly PlanarPoint[]): boolean {
  if (points.length < 3 || points.length > 12) return false;
  const area = points.reduce((sum, point, i) => sum + point.x * points[(i + 1) % points.length].y - point.y * points[(i + 1) % points.length].x, 0) / 2;
  if (Math.abs(area) <= 1) return false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], previous = points[(i + points.length - 1) % points.length];
    if (networkDistance(a, b) <= NETWORK_EPSILON || networkPointOnSegment(b, previous, a) || networkPointOnSegment(previous, a, b)) return false;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      if (networkIntersection(a, b, c, d) || networkPointOnSegment(c, a, b) || networkPointOnSegment(d, a, b) || networkPointOnSegment(a, c, d) || networkPointOnSegment(b, c, d)) return false;
    }
  }
  return true;
}
export function networkSameDirectedRay(vertex: PlanarPoint, a: PlanarPoint, b: PlanarPoint): boolean {
  const ax = a.x - vertex.x, ay = a.y - vertex.y, bx = b.x - vertex.x, by = b.y - vertex.y;
  return ax * bx + ay * by > 0 && Math.abs(ax * by - ay * bx) <= NETWORK_EPSILON * Math.hypot(ax, ay) * Math.hypot(bx, by);
}
export function networkAnglesEqual(graph: NetworkGraph, first: readonly number[], second: readonly number[]): boolean {
  if (first.length !== 3 || second.length !== 3 || first[1] !== second[1]) return false;
  const lookup = new Map(graph.nodes.map((node) => [node.id, node])), vertex = lookup.get(first[1]);
  const a = lookup.get(first[0]), b = lookup.get(first[2]), c = lookup.get(second[0]), d = lookup.get(second[2]);
  return !!vertex && !!a && !!b && !!c && !!d && ((networkSameDirectedRay(vertex, a, c) && networkSameDirectedRay(vertex, b, d)) || (networkSameDirectedRay(vertex, a, d) && networkSameDirectedRay(vertex, b, c)));
}
export function networkFigureValid(graph: NetworkGraph, kind: Exclude<NetworkRecordKind, "stroke">, ids: readonly number[]): boolean {
  if ((kind === "segment" && ids.length !== 2) || (kind === "angle" && ids.length !== 3) || (kind === "figure" && (ids.length < 3 || ids.length > 12)) || new Set(ids).size !== ids.length) return false;
  const points = ids.map((id) => graph.nodes.find((node) => node.id === id));
  if (points.some((point) => !point) || (kind === "figure" && !networkSimplePolygon(points as NetworkNode[]))) return false;
  if (kind === "angle" && networkSameDirectedRay(points[1]!, points[0]!, points[2]!)) return false;
  for (let i = 0; i < ids.length - (kind === "figure" ? 0 : 1); i++) if (!networkCoveredNodes(graph, ids[i], ids[(i + 1) % ids.length])) return false;
  return true;
}
export function networkPicks(state: PlanarState): number[] {
  return state.marks.filter((mark) => mark.startsWith("pick.")).map((mark) => mark.split(".").map(Number)).sort((a, b) => a[1] - b[1]).map((parts) => parts[2]);
}
export function networkRecords(state: PlanarState): NetworkRecord[] {
  const records = new Map<string, NetworkRecord & { entries: [number, number][] }>();
  for (const mark of state.marks) {
    const [kind, id, index, node] = mark.split(".");
    if (kind === "pick") continue;
    const key = `${kind}.${id}`, record = records.get(key) ?? { kind: kind as NetworkRecordKind, id: Number(id), nodes: [], entries: [] };
    record.entries.push([Number(index), Number(node)]); records.set(key, record);
  }
  return [...records.values()].map(({ entries, ...record }) => ({ ...record, nodes: entries.sort((a, b) => a[0] - b[0]).map((entry) => entry[1]) })).sort((a, b) => a.id - b.id);
}
export function networkMarks(picks: readonly number[], records: readonly NetworkRecord[]): string[] {
  return [...picks.map((node, index) => `pick.${index}.${node}`), ...records.flatMap((record) => record.nodes.map((node, index) => `${record.kind}.${record.id}.${index}.${node}`))];
}
function cleanNetworkRecords(state: PlanarState, graph: NetworkGraph, remap: Map<number, number>): PlanarState {
  const existing = new Set(graph.nodes.map((node) => node.id)), mapped = (id: number) => remap.get(id) ?? id;
  const picks = [...new Set(networkPicks(state).map(mapped).filter((id) => existing.has(id)))];
  const records: NetworkRecord[] = [], used = new Set<string>();
  let visits = 0;
  for (const record of networkRecords(state)) {
    const nodes = record.nodes.map(mapped);
    if (record.kind !== "stroke") {
      if (networkFigureValid(graph, record.kind, nodes) && (record.kind !== "angle" || !records.some((other) => other.kind === "angle" && networkAnglesEqual(graph, other.nodes, nodes)))) records.push({ ...record, nodes });
      continue;
    }
    const kept: number[] = [];
    for (const id of nodes) {
      if (!existing.has(id) || visits >= 192) break;
      if (kept.length === 0) { kept.push(id); visits++; continue; }
      if (kept.at(-1) === id) continue;
      const chain = networkCoveredNodes(graph, kept.at(-1)!, id);
      if (!chain || visits + chain.length - 1 > 192 || (!state.flags.repeat && chain.slice(1).some((node, i) => used.has(networkEdgeKey(chain[i], node))))) break;
      for (let i = 1; i < chain.length; i++) { used.add(networkEdgeKey(chain[i - 1], chain[i])); kept.push(chain[i]); visits++; }
    }
    if (kept.length) records.push({ ...record, nodes: kept });
  }
  return { ...state, marks: networkMarks(picks, records), params: { ...state.params, currentStroke: records.some((record) => record.kind === "stroke" && record.id === state.params.currentStroke) ? state.params.currentStroke : -1 } };
}
function commitGraph(state: PlanarState, source: NetworkGraph, selection?: { node: number; edge: number }): PlanarState {
  const normalized = normalizeNetwork(source);
  if (!normalized) return state;
  const { graph, remap } = normalized;
  const params = Object.fromEntries(NETWORK_GLOBALS.map((key) => [key, state.params[key]]));
  params.nextNode = graph.nextNode; params.nextEdge = graph.nextEdge;
  if (selection) { params.activeNode = selection.node; params.activeEdge = selection.edge; }
  params.activeNode = remap.get(params.activeNode) ?? params.activeNode;
  if (!graph.nodes.some((node) => node.id === params.activeNode)) params.activeNode = -1;
  if (!graph.edges.some((edge) => edge.id === params.activeEdge)) params.activeEdge = -1;
  for (const edge of graph.edges) { params[`a.${edge.id}`] = edge.a; params[`b.${edge.id}`] = edge.b; }
  return cleanNetworkRecords({ ...state, params, points: Object.fromEntries(graph.nodes.map(({ id, x, y }) => [`node.${id}`, { x, y }])), phase: 1 }, graph, remap);
}
const boundedPoint = (point: PlanarPoint): PlanarPoint => ({ x: Math.max(-1000, Math.min(2000, point.x)), y: Math.max(-1000, Math.min(1720, point.y)) });
function snapPoint(state: PlanarState, point: PlanarPoint, except: readonly number[] = []): PlanarPoint {
  const safe = boundedPoint(point);
  if (!state.flags.snap) return safe;
  const nearest = networkGraph(state).nodes.filter((node) => !except.includes(node.id)).sort((a, b) => networkDistance(a, safe) - networkDistance(b, safe))[0];
  if (nearest && networkDistance(nearest, safe) <= 18) return { x: nearest.x, y: nearest.y };
  return boundedPoint({ x: Math.round(safe.x / 30) * 30, y: Math.round(safe.y / 30) * 30 });
}
export function addNetworkPoint(state: PlanarState, point: PlanarPoint): PlanarState {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return state;
  const graph = networkGraph(state), location = snapPoint(state, point);
  if (graph.nodes.length >= NETWORK_LIMIT || graph.nextNode >= 99999 || graph.nodes.some((node) => networkDistance(node, location) <= NETWORK_EPSILON)) return state;
  const id = graph.nextNode++;
  return commitGraph(state, { ...graph, nodes: [...graph.nodes, { ...location, id }] }, { node: id, edge: -1 });
}
export function addNetworkSegment(state: PlanarState, a: PlanarPoint, b: PlanarPoint): PlanarState {
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return state;
  const graph = networkGraph(state), from = snapPoint(state, a), to = snapPoint(state, b);
  if (networkDistance(from, to) <= NETWORK_EPSILON || graph.nextEdge >= 99999) return state;
  const nodes = [...graph.nodes];
  const nodeId = (point: PlanarPoint) => {
    const existing = nodes.find((node) => networkDistance(node, point) <= NETWORK_EPSILON);
    if (existing) return existing.id;
    const id = graph.nextNode++; nodes.push({ ...point, id }); return id;
  };
  const fromId = nodeId(from), toId = nodeId(to), id = graph.nextEdge++;
  if (graph.nextNode > 99999 || graph.edges.some((edge) => networkEdgeKey(edge.a, edge.b) === networkEdgeKey(fromId, toId))) return state;
  return commitGraph(state, { ...graph, nodes, edges: [...graph.edges, { id, a: Math.min(fromId, toId), b: Math.max(fromId, toId) }] }, { node: -1, edge: id });
}
export function addNetworkMaterial(state: PlanarState, material: NetworkMaterial): PlanarState {
  const graph = networkGraph(state), offset = ((graph.nextNode + 1) % 5) * 24;
  let source: PlaneGraph;
  if (material === "grid") source = gridGraph(state.params.columns, state.params.rows, 70, { x: 280 + offset, y: 540 - offset });
  else if (material === "triangle") { const triangle = triangleGraph(state.params.levels); source = { ...triangle, points: triangle.points.map((point) => ({ ...point, x: point.x + offset, y: point.y + offset })) }; }
  else if (material === "rays") {
    const center = { id: "O", x: 400 + offset, y: 450 - offset };
    const ends = Array.from({ length: state.params.rays }, (_, index) => { const angle = (-145 + index * 130 / (state.params.rays - 1)) * Math.PI / 180; return { id: String(index), x: center.x + Math.cos(angle) * 210, y: center.y + Math.sin(angle) * 210 }; });
    source = { points: [center, ...ends], edges: ends.map((point) => ({ a: "O", b: point.id })) };
  } else source = { points: [{ id: "a", x: 260 + offset, y: 250 + offset }, { id: "b", x: 600 + offset, y: 250 + offset }], edges: [{ a: "a", b: "b" }] };
  if (graph.nextNode + source.points.length > 99999 || graph.nextEdge + source.edges.length > 99999) return state;
  const mapping = new Map(source.points.map((point) => [point.id, graph.nextNode++]));
  return commitGraph(state, { ...graph, nodes: [...graph.nodes, ...source.points.map((point) => ({ x: point.x, y: point.y, id: mapping.get(point.id)! }))], edges: [...graph.edges, ...source.edges.map((edge) => ({ id: graph.nextEdge++, a: Math.min(mapping.get(edge.a)!, mapping.get(edge.b)!), b: Math.max(mapping.get(edge.a)!, mapping.get(edge.b)!) }))], nextEdge: graph.nextEdge });
}
export function removeNetworkTarget(state: PlanarState, target: string | null): PlanarState {
  const parsed = parseNetworkTarget(target), graph = networkGraph(state);
  if (!parsed) return state;
  if (parsed.kind === "node") return commitGraph(state, { ...graph, nodes: graph.nodes.filter((node) => node.id !== parsed.id), edges: graph.edges.filter((edge) => edge.a !== parsed.id && edge.b !== parsed.id) });
  return commitGraph(state, { ...graph, edges: graph.edges.filter((edge) => edge.id !== parsed.id) });
}
export function moveNetworkTarget(start: PlanarState, target: string, delta: PlanarPoint): PlanarState {
  if (!start.flags.edit || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return start;
  const parsed = parseNetworkTarget(target), graph = networkGraph(start);
  if (!parsed) return start;
  const edge = graph.edges.find((item) => item.id === parsed.id);
  const ids = parsed.kind === "node" ? [parsed.id] : edge ? [edge.a, edge.b] : [];
  const moved = graph.nodes.filter((node) => ids.includes(node.id));
  if (!moved.length) return start;
  const offset = { x: Math.max(-1000 - Math.min(...moved.map((n) => n.x)), Math.min(2000 - Math.max(...moved.map((n) => n.x)), delta.x)), y: Math.max(-1000 - Math.min(...moved.map((n) => n.y)), Math.min(1720 - Math.max(...moved.map((n) => n.y)), delta.y)) };
  const nodes = graph.nodes.map((node) => ids.includes(node.id) ? { ...node, ...(ids.length === 1 ? snapPoint(start, { x: node.x + offset.x, y: node.y + offset.y }, ids) : { x: node.x + offset.x, y: node.y + offset.y }) } : node);
  return commitGraph(start, { ...graph, nodes }, { node: parsed.kind === "node" ? parsed.id : -1, edge: parsed.kind === "edge" ? parsed.id : -1 });
}
export function appendNetworkVisit(state: PlanarState, node: number): PlanarState {
  const graph = networkGraph(state), records = networkRecords(state), strokes = records.filter((record) => record.kind === "stroke");
  if (!graph.nodes.some((point) => point.id === node) || strokes.reduce((sum, stroke) => sum + stroke.nodes.length, 0) >= 192) return state;
  if (state.params.currentStroke === -1) {
    if (strokes.length >= 32 || state.params.nextStroke >= 99999) return state;
    const id = state.params.nextStroke;
    return { ...state, params: { ...state.params, currentStroke: id, nextStroke: id + 1 }, marks: networkMarks([], [...strokes, { kind: "stroke", id, nodes: [node] }]), phase: 1 };
  }
  const current = strokes.find((stroke) => stroke.id === state.params.currentStroke);
  if (!current || current.nodes.at(-1) === node) return state;
  const chain = networkCoveredNodes(graph, current.nodes.at(-1)!, node);
  if (!chain || strokes.reduce((sum, stroke) => sum + stroke.nodes.length, 0) + chain.length - 1 > 192) return state;
  const ordered = [...strokes.filter((stroke) => stroke !== current), current];
  const planeGraph = networkAsPlaneGraph(graph);
  let result = ordered.map((stroke) => stroke.nodes.map(String));
  for (const next of chain.slice(1)) {
    const updated = appendPath(planeGraph, result, String(next), state.flags.repeat);
    if (updated.at(-1)!.length === result.at(-1)!.length) return state;
    result = updated;
  }
  const nodes = result.at(-1)!.map(Number);
  if (nodes.length === current.nodes.length) return state;
  return { ...state, marks: networkMarks([], strokes.map((stroke) => stroke === current ? { ...stroke, nodes } : stroke)), phase: 1 };
}
export function tapNetworkTarget(state: PlanarState, target: string): PlanarState {
  const parsed = parseNetworkTarget(target), graph = networkGraph(state);
  if (!parsed || (parsed.kind === "node" ? !graph.nodes.some((node) => node.id === parsed.id) : !graph.edges.some((edge) => edge.id === parsed.id))) return state;
  const selected = { ...state, params: { ...state.params, activeNode: parsed.kind === "node" ? parsed.id : -1, activeEdge: parsed.kind === "edge" ? parsed.id : -1 } };
  if (state.flags.edit || parsed.kind !== "node") return selected;
  if (state.sceneId === "52-create") return appendNetworkVisit(selected, parsed.id);
  const previous = networkPicks(state), limit = state.params.figureMode === 0 ? 2 : state.params.figureMode === 1 ? 3 : 12;
  const next = previous.includes(parsed.id) ? previous.filter((id) => id !== parsed.id) : [...(previous.length >= limit ? [] : previous), parsed.id];
  return { ...selected, marks: networkMarks(next, networkRecords(state)) };
}
export function dragNetworkTarget(start: PlanarState, target: string, point: PlanarPoint, delta: PlanarPoint, previous?: PlanarState): PlanarState {
  if (start.flags.edit) return moveNetworkTarget(start, target, delta);
  if (start.sceneId !== "52-create") return start;
  const parsed = parseNetworkTarget(target);
  if (parsed?.kind !== "node") return start;
  let state = previous ?? start;
  if (state === start || state.params.currentStroke === -1) state = appendNetworkVisit(state, parsed.id);
  const nearest = networkGraph(state).nodes.sort((a, b) => networkDistance(a, point) - networkDistance(b, point))[0];
  return nearest && networkDistance(nearest, point) <= 26 ? appendNetworkVisit(state, nearest.id) : state;
}
export function recordNetworkFigure(state: PlanarState): PlanarState {
  const nodes = networkPicks(state), records = networkRecords(state), graph = networkGraph(state), kind = (["segment", "angle", "figure"] as const)[state.params.figureMode];
  if (state.sceneId !== "47-create" || !kind || records.length >= 24 || state.params.nextRecord >= 99999 || !networkFigureValid(graph, kind, nodes)) return state;
  const canonical = (ids: number[]) => { const variants = [ids, [...ids].reverse()]; return (kind === "figure" ? variants.flatMap((sequence) => sequence.map((_, i) => [...sequence.slice(i), ...sequence.slice(0, i)].join("."))) : variants.map((sequence) => sequence.join("."))).sort()[0]; };
  if (records.some((record) => record.kind === kind && (kind === "angle" ? networkAnglesEqual(graph, record.nodes, nodes) : canonical(record.nodes) === canonical(nodes)))) return { ...state, marks: networkMarks([], records) };
  return { ...state, params: { ...state.params, nextRecord: state.params.nextRecord + 1 }, marks: networkMarks([], [...records, { kind, id: state.params.nextRecord, nodes }]) };
}
export const liftNetworkPen = (state: PlanarState): PlanarState => ({ ...state, params: { ...state.params, currentStroke: -1 } });
export const clearNetworkRecords = (state: PlanarState): PlanarState => ({ ...state, marks: [], params: { ...state.params, currentStroke: -1 }, phase: 1 });
export function setNetworkField(state: PlanarState, key: string, value: number): PlanarState {
  const ranges: Record<string, [number, number]> = { figureMode: [0, 2], rays: [2, 8], columns: [1, 5], rows: [1, 4], levels: [1, 4] };
  const range = ranges[key];
  if (!range || !Number.isInteger(value) || value < range[0] || value > range[1]) return state;
  return { ...state, params: { ...state.params, [key]: value }, marks: key === "figureMode" ? state.marks.filter((mark) => !mark.startsWith("pick.")) : state.marks };
}
export function setNetworkFlag(state: PlanarState, key: string, value: boolean): PlanarState {
  if (!(NETWORK_FLAGS as readonly string[]).includes(key)) return state;
  const updated = { ...state, flags: { ...state.flags, [key]: value } };
  return key === "repeat" && !value ? cleanNetworkRecords(updated, networkGraph(updated), new Map()) : updated;
}
