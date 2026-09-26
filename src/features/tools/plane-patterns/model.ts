import type { PlanePoint } from "../planar-interaction/geometry";

export const PATTERN_SCENES = ["segments", "angles", "triangles", "rectangles", "matches", "oneStroke", "gridPaths", "domino"] as const;
export type PatternSceneId = (typeof PATTERN_SCENES)[number];
export interface GraphPoint extends PlanePoint { id: string }
export interface GraphEdge { a: string; b: string }
export interface PlaneGraph { points: GraphPoint[]; edges: GraphEdge[] }
export interface FigureMark { vertices: string[]; id: string }
export interface Matchstick { id: string; center: PlanePoint; angle: number; length: number }
export interface Domino { id: string; column: number; row: number; vertical: boolean }
export const edgeKey = (a: string, b: string) => [a, b].sort().join("|");
const cross = (a: PlanePoint, b: PlanePoint, c: PlanePoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** 复合图形的每条边必须被现有线段连续覆盖；不能越过缺边直接高亮。 */
export function coveredSegment(a: PlanePoint, b: PlanePoint, graph: PlaneGraph): boolean {
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (lengthSquared < 1e-8) return false;
  const project = (point: PlanePoint) => ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSquared;
  const points = new Map(graph.points.map((point) => [point.id, point]));
  const ranges = graph.edges.flatMap((edge) => {
    const from = points.get(edge.a), to = points.get(edge.b);
    if (!from || !to || Math.abs(cross(a, b, from)) > 1e-6 || Math.abs(cross(a, b, to)) > 1e-6) return [];
    const x = project(from), y = project(to);
    return [[Math.max(0, Math.min(x, y)), Math.min(1, Math.max(x, y))]];
  }).filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [from, to] of ranges) {
    if (from > covered + 1e-6) return false;
    covered = Math.max(covered, to);
    if (covered >= 1 - 1e-6) return true;
  }
  return false;
}
export function figureFromVertices(graph: PlaneGraph, ids: string[], close = true): FigureMark | null {
  if (ids.length < 2 || new Set(ids).size !== ids.length) return null;
  const vertices = ids.map((id) => graph.points.find((point) => point.id === id));
  if (vertices.some((point) => !point)) return null;
  const points = vertices as GraphPoint[];
  if (close && points.length >= 3 && Math.abs(cross(points[0], points[1], points[2])) < 1e-6) return null;
  const edges = close ? points.length : points.length - 1;
  for (let index = 0; index < edges; index++) if (!coveredSegment(points[index], points[(index + 1) % points.length], graph)) return null;
  return { vertices: ids, id: [...ids].sort().join("|") };
}
export function gridGraph(columns = 4, rows = 3, step = 82, origin: PlanePoint = { x: 250, y: 500 }): PlaneGraph {
  const points: GraphPoint[] = [], edges: GraphEdge[] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    points.push({ id: `${x},${y}`, x: origin.x + x * step, y: origin.y - y * step });
    if (x > 0) edges.push({ a: `${x - 1},${y}`, b: `${x},${y}` });
    if (y > 0) edges.push({ a: `${x},${y - 1}`, b: `${x},${y}` });
  }
  return { points, edges };
}
export function triangleGraph(levels = 3): PlaneGraph {
  const points: GraphPoint[] = [], edges: GraphEdge[] = [], size = 100;
  for (let row = 0; row <= levels; row++) for (let column = 0; column <= row; column++) {
    points.push({ id: `${column},${row}`, x: 460 + (column - row / 2) * size, y: 170 + row * size * Math.sqrt(3) / 2 });
    if (column > 0) edges.push({ a: `${column - 1},${row}`, b: `${column},${row}` });
    if (row > 0 && column < row) edges.push({ a: `${column},${row - 1}`, b: `${column},${row}` });
    if (row > 0 && column > 0) edges.push({ a: `${column - 1},${row - 1}`, b: `${column},${row}` });
  }
  return { points, edges };
}
export function sceneGraph(scene: PatternSceneId): PlaneGraph {
  if (scene === "triangles") return triangleGraph();
  if (scene === "rectangles" || scene === "gridPaths") return gridGraph();
  if (scene === "segments") return { points: Array.from({ length: 6 }, (_, index) => ({ id: String.fromCharCode(65 + index), x: 200 + index * 100, y: 350 })), edges: Array.from({ length: 5 }, (_, index) => ({ a: String.fromCharCode(65 + index), b: String.fromCharCode(66 + index) })) };
  if (scene === "angles") {
    const center = { id: "O", x: 360, y: 430 }, ends = Array.from({ length: 5 }, (_, index) => ({ id: String.fromCharCode(65 + index), x: center.x + Math.cos((-100 + index * 32) * Math.PI / 180) * 240, y: center.y + Math.sin((-100 + index * 32) * Math.PI / 180) * 240 }));
    return { points: [center, ...ends], edges: ends.map((point) => ({ a: "O", b: point.id })) };
  }
  return {
    points: [{ id: "A", x: 310, y: 470 }, { id: "B", x: 610, y: 470 }, { id: "C", x: 610, y: 280 }, { id: "D", x: 310, y: 280 }, { id: "E", x: 460, y: 155 }],
    edges: [{ a: "A", b: "B" }, { a: "B", b: "C" }, { a: "C", b: "D" }, { a: "D", b: "A" }, { a: "C", b: "E" }, { a: "E", b: "D" }, { a: "A", b: "C" }],
  };
}
export function rectangleVertices(graph: PlaneGraph, fromId: string, toId: string): string[] | null {
  const from = graph.points.find((point) => point.id === fromId), to = graph.points.find((point) => point.id === toId);
  if (!from || !to || from.x === to.x || from.y === to.y) return null;
  const right = graph.points.find((point) => point.x === to.x && point.y === from.y), left = graph.points.find((point) => point.x === from.x && point.y === to.y);
  return right && left ? [fromId, right.id, toId, left.id] : null;
}
export function graphDegree(graph: PlaneGraph, id: string, blocked: readonly string[] = []): number {
  return graph.edges.filter((edge) => (edge.a === id || edge.b === id) && !blocked.includes(edgeKey(edge.a, edge.b))).length;
}
export function appendPath(graph: PlaneGraph, strokes: readonly string[][], id: string, allowRepeat: boolean, blocked: readonly string[] = [], monotone = false): string[][] {
  const paths = strokes.map((path) => [...path]);
  const current = paths.at(-1) ?? [], last = current.at(-1);
  if (!graph.points.some((point) => point.id === id)) return paths;
  if (!last) return [...paths.slice(0, -1), [id]];
  const key = edgeKey(last, id);
  if (blocked.includes(key) || !graph.edges.some((edge) => edgeKey(edge.a, edge.b) === key)) return paths;
  if (!allowRepeat && paths.some((path) => path.some((point, index) => index > 0 && edgeKey(path[index - 1], point) === key))) return paths;
  if (monotone) {
    const previous = graph.points.find((point) => point.id === last)!, next = graph.points.find((point) => point.id === id)!;
    if (next.x < previous.x || next.y > previous.y) return paths;
  }
  if (paths.length === 0) return [[id]];
  paths[paths.length - 1] = [...current, id];
  return paths;
}
/** 标数按格点依赖计算，显示到哪一个点由老师决定；不自动展示终点答案。 */
export function gridRouteCounts(columns: number, rows: number, blocked: readonly string[] = [], through?: string): Record<string, number> {
  const before: Record<string, number> = {}, after: Record<string, number> = {};
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    const id = `${x},${y}`;
    const predecessors = [x > 0 ? `${x - 1},${y}` : null, y > 0 ? `${x},${y - 1}` : null].filter((p): p is string => p !== null && !blocked.includes(edgeKey(p, id)));
    before[id] = id === "0,0" ? 1 : predecessors.reduce((sum, point) => sum + before[point], 0);
    after[id] = through ? id === through ? before[id] : predecessors.reduce((sum, point) => sum + after[point], 0) : before[id];
  }
  return after;
}
export function initialMatches(): Matchstick[] {
  return gridGraph(3, 1, 100, { x: 280, y: 420 }).edges.map((edge, index) => {
    const graph = gridGraph(3, 1, 100, { x: 280, y: 420 }), a = graph.points.find((point) => point.id === edge.a)!, b = graph.points.find((point) => point.id === edge.b)!;
    return { id: `match-${index}`, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, length: 100 };
  });
}
export function matchEndpoints(match: Matchstick): [PlanePoint, PlanePoint] {
  const dx = Math.cos(match.angle * Math.PI / 180) * match.length / 2, dy = Math.sin(match.angle * Math.PI / 180) * match.length / 2;
  return [{ x: match.center.x - dx, y: match.center.y - dy }, { x: match.center.x + dx, y: match.center.y + dy }];
}
export function snapMatch(match: Matchstick, others: readonly Matchstick[], threshold = 16): Matchstick {
  let offset: PlanePoint | null = null, distance = threshold;
  for (const endpoint of matchEndpoints(match)) for (const other of others) for (const target of matchEndpoints(other)) {
    const next = Math.hypot(target.x - endpoint.x, target.y - endpoint.y);
    if (next < distance) { distance = next; offset = { x: target.x - endpoint.x, y: target.y - endpoint.y }; }
  }
  return offset ? { ...match, center: { x: match.center.x + offset.x, y: match.center.y + offset.y } } : match;
}
export function dominoCells(domino: Domino): [string, string] {
  return [`${domino.column},${domino.row}`, `${domino.column + (domino.vertical ? 0 : 1)},${domino.row + (domino.vertical ? 1 : 0)}`];
}
export function placeDomino(domino: Domino, others: readonly Domino[], removed: readonly string[], columns = 6, rows = 6): boolean {
  const cells = dominoCells(domino), occupied = new Set(others.filter((other) => other.id !== domino.id).flatMap(dominoCells));
  return cells.every((cell) => {
    const [x, y] = cell.split(",").map(Number);
    return x >= 0 && x < columns && y >= 0 && y < rows && !removed.includes(cell) && !occupied.has(cell);
  });
}
export function boardColorCounts(removed: readonly string[], dominoes: readonly Domino[] = [], columns = 6, rows = 6) {
  const occupied = new Set(dominoes.flatMap(dominoCells)), result = { dark: 0, light: 0 };
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const key = `${column},${row}`;
    if (!removed.includes(key) && !occupied.has(key)) result[(column + row) % 2 === 0 ? "light" : "dark"]++;
  }
  return result;
}
