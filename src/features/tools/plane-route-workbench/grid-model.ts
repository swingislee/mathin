import type { PlanarPoint, PlanarState } from "../planar-kit/contract";

export const GRID_ROUTE_SCENE = "53-create";
export const ROUTE_LIMIT = 8;
export const GRID_LIMIT = 12;
export const GRID_VISIT_LIMIT = 480;
export const GRID_ROUTE_GLOBALS = ["columns", "rows", "nextId", "active", "direction", "numberStep"] as const;
export const GRID_ROUTE_FLAGS = ["grid", "measures", "names", "required", "shortest", "highlights"] as const;
export const gridPointKey = (point: PlanarPoint) => `${point.x}_${point.y}`;
export const sameGridPoint = (a: PlanarPoint, b: PlanarPoint) => a.x === b.x && a.y === b.y;
const bounded = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const zero = BigInt(0), one = BigInt(1);
export const gridCandidateIds = (state: PlanarState) => Object.keys(state.params).filter((key) => /^visits\.(0|[1-9]\d{0,4})$/.test(key)).map((key) => Number(key.slice(7))).sort((a, b) => a - b);
export function routeTargetId(target: string | null): number | null {
  const match = /^(?:route|contact)\.(0|[1-9]\d{0,4})$/.exec(target ?? "");
  return match ? Number(match[1]) : null;
}
export function gridCandidate(state: PlanarState, id = state.params.active): PlanarPoint[] {
  return state.marks.filter((mark) => mark.startsWith(`visit.${id}.`)).map((mark) => {
    const parts = mark.split("."), [x, y] = parts[3].split("_").map(Number);
    return { step: Number(parts[2]), x, y };
  }).sort((a, b) => a.step - b.step).map(({ x, y }) => ({ x, y }));
}
export function gridPointInside(state: PlanarState, point: PlanarPoint): boolean {
  return Number.isInteger(point.x) && Number.isInteger(point.y) && point.x >= 0 && point.x <= state.params.columns && point.y >= 0 && point.y <= state.params.rows;
}
export function gridRoadClosed(state: PlanarState, a: PlanarPoint, b: PlanarPoint): boolean {
  const horizontal = a.y === b.y, key = horizontal ? `h.${a.y}` : `v.${a.x}`, bit = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
  return !!((state.params[key] ?? 0) & (1 << bit));
}
export function gridStepAllowed(state: PlanarState, a: PlanarPoint, b: PlanarPoint): boolean {
  if (!gridPointInside(state, a) || !gridPointInside(state, b) || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1 || gridRoadClosed(state, a, b)) return false;
  if (state.params.direction === 1) return true;
  const dx = b.x - a.x, dy = b.y - a.y, start = state.points.start, end = state.points.end;
  return (!dx || dx === Math.sign(end.x - start.x)) && (!dy || dy === Math.sign(end.y - start.y));
}
function writeGridCandidates(state: PlanarState, candidates: readonly { id: number; points: readonly PlanarPoint[] }[]): PlanarState {
  const params = Object.fromEntries(Object.entries(state.params).filter(([key]) => !key.startsWith("visits."))), marks: string[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.id - b.id)) {
    params[`visits.${candidate.id}`] = candidate.points.length;
    candidate.points.forEach((point, index) => marks.push(`visit.${candidate.id}.${index}.${gridPointKey(point)}`));
  }
  params.active = candidates.some((candidate) => candidate.id === params.active) ? params.active : candidates[0]?.id ?? -1;
  return { ...state, params, marks, phase: 1 };
}
function repairGridCandidates(state: PlanarState): PlanarState {
  const candidates = gridCandidateIds(state).map((id) => {
    const original = gridCandidate(state, id), startIndex = original.findIndex((point) => sameGridPoint(point, state.points.start));
    const source = startIndex < 0 ? [state.points.start] : original.slice(startIndex), points = [{ ...state.points.start }];
    for (const point of source.slice(1)) {
      if (!gridStepAllowed(state, points.at(-1)!, point)) break;
      points.push(point);
    }
    return { id, points };
  });
  return writeGridCandidates({ ...state, params: { ...state.params, numberStep: -1 } }, candidates);
}
export function createGridRouteState(): PlanarState {
  const params: Record<string, number> = { columns: 4, rows: 3, nextId: 0, active: -1, direction: 0, numberStep: -1 };
  for (let y = 0; y <= params.rows; y++) params[`h.${y}`] = 0;
  for (let x = 0; x <= params.columns; x++) params[`v.${x}`] = 0;
  return addGridCandidate({ sceneId: GRID_ROUTE_SCENE, params, points: { start: { x: 0, y: 0 }, end: { x: 4, y: 3 }, required: { x: 2, y: 1 } }, flags: { grid: false, measures: false, names: false, required: false, shortest: false, highlights: true }, marks: [], phase: 1 });
}
export function addGridCandidate(state: PlanarState, copy = false): PlanarState {
  const ids = gridCandidateIds(state), points = copy ? gridCandidate(state) : [{ ...state.points.start }];
  if (ids.length >= ROUTE_LIMIT || state.params.nextId >= 99999 || !points.length || state.marks.length + points.length > GRID_VISIT_LIMIT) return state;
  const id = state.params.nextId;
  return writeGridCandidates({ ...state, params: { ...state.params, nextId: id + 1, active: id } }, [...ids.map((existing) => ({ id: existing, points: gridCandidate(state, existing) })), { id, points }]);
}
export function selectGridCandidate(state: PlanarState, id: number): PlanarState {
  return gridCandidateIds(state).includes(id) && state.params.active !== id ? { ...state, params: { ...state.params, active: id }, phase: 1 } : state;
}
export function cycleGridCandidate(state: PlanarState, direction: number): PlanarState {
  const ids = gridCandidateIds(state);
  return ids.length ? selectGridCandidate(state, ids[(ids.indexOf(state.params.active) + direction + ids.length) % ids.length]) : state;
}
export function removeGridCandidate(state: PlanarState): PlanarState {
  if (state.params.active === -1) return state;
  return writeGridCandidates(state, gridCandidateIds(state).filter((id) => id !== state.params.active).map((id) => ({ id, points: gridCandidate(state, id) })));
}
export function shortenGridCandidate(state: PlanarState, clear = false): PlanarState {
  const points = gridCandidate(state);
  if (points.length <= 1) return state;
  return writeGridCandidates(state, gridCandidateIds(state).map((id) => ({ id, points: id === state.params.active ? points.slice(0, clear ? 1 : -1) : gridCandidate(state, id) })));
}
/** 每条候选独立走访；其他候选已经走过的道路仍可使用。快拖仅补齐同一直线的边，不代选拐弯。 */
export function appendGridVisit(state: PlanarState, point: PlanarPoint): PlanarState {
  const points = gridCandidate(state), last = points.at(-1);
  if (!last || !gridPointInside(state, point) || sameGridPoint(last, point) || (last.x !== point.x && last.y !== point.y)) return state;
  const count = Math.abs(last.x - point.x) + Math.abs(last.y - point.y);
  if (state.marks.length + count > GRID_VISIT_LIMIT) return state;
  const dx = Math.sign(point.x - last.x), dy = Math.sign(point.y - last.y), next = [...points];
  for (let step = 1; step <= count; step++) {
    const candidate = { x: last.x + dx * step, y: last.y + dy * step };
    if (!gridStepAllowed(state, next.at(-1)!, candidate)) return state;
    next.push(candidate);
  }
  return writeGridCandidates(state, gridCandidateIds(state).map((id) => ({ id, points: id === state.params.active ? next : gridCandidate(state, id) })));
}
export function toggleGridRoad(state: PlanarState, a: PlanarPoint, b: PlanarPoint): PlanarState {
  if (!gridPointInside(state, a) || !gridPointInside(state, b) || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return state;
  const horizontal = a.y === b.y, key = horizontal ? `h.${a.y}` : `v.${a.x}`, bit = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
  return repairGridCandidates({ ...state, params: { ...state.params, [key]: state.params[key] ^ (1 << bit) } });
}
export function openGridRoads(state: PlanarState): PlanarState {
  const params: Record<string, number> = { ...state.params, numberStep: -1 };
  for (const key of Object.keys(params)) if (/^[hv]\./.test(key)) params[key] = 0;
  return { ...state, params };
}
/** 缩小格网收回端点，保留各候选直到首个失效路段；候选身份不替换，撤销可还原全部现场。 */
export function resizeGridRoutes(state: PlanarState, columns: number, rows: number): PlanarState {
  if (![columns, rows].every((value) => Number.isInteger(value) && value >= 1 && value <= GRID_LIMIT) || (columns === state.params.columns && rows === state.params.rows)) return state;
  const params = Object.fromEntries(Object.entries(state.params).filter(([key]) => !/^[hv]\./.test(key)));
  params.columns = columns; params.rows = rows;
  for (let y = 0; y <= rows; y++) params[`h.${y}`] = (state.params[`h.${y}`] ?? 0) & ((1 << columns) - 1);
  for (let x = 0; x <= columns; x++) params[`v.${x}`] = (state.params[`v.${x}`] ?? 0) & ((1 << rows) - 1);
  const points = Object.fromEntries(Object.entries(state.points).map(([key, point]) => [key, { x: bounded(point.x, 0, columns), y: bounded(point.y, 0, rows) }]));
  return repairGridCandidates({ ...state, params, points });
}
export function setGridPoint(state: PlanarState, key: "start" | "end" | "required", point: PlanarPoint): PlanarState {
  if (!gridPointInside(state, point) || sameGridPoint(point, state.points[key])) return state;
  const next = { ...state, params: { ...state.params, numberStep: -1 }, points: { ...state.points, [key]: { ...point } } };
  return key === "required" ? next : repairGridCandidates(next);
}
export function setGridRouteField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isInteger(value)) return state;
  if (key === "columns" || key === "rows") return resizeGridRoutes(state, key === "columns" ? value : state.params.columns, key === "rows" ? value : state.params.rows);
  if (key === "candidate") return selectGridCandidate(state, value - 1);
  if (key === "direction") return value === 0 || value === 1 ? repairGridCandidates({ ...state, params: { ...state.params, direction: value } }) : state;
  const match = /^(start|end|required)(X|Y)$/.exec(key);
  if (!match) return state;
  const target = match[1] as "start" | "end" | "required";
  return setGridPoint(state, target, { ...state.points[target], [match[2].toLowerCase()]: value });
}
export function setGridRouteFlag(state: PlanarState, key: string, value: boolean): PlanarState {
  if (!(GRID_ROUTE_FLAGS as readonly string[]).includes(key) || key === "grid") return state;
  return { ...state, flags: { ...state.flags, [key]: value }, params: { ...state.params, numberStep: key === "required" ? -1 : state.params.numberStep } };
}
export function revealGridNumber(state: PlanarState): PlanarState {
  const last = (state.params.columns + 1) * (state.params.rows + 1) - 1;
  return state.params.numberStep >= last ? state : { ...state, params: { ...state.params, numberStep: state.params.numberStep + 1 } };
}
export function gridLayout(state: PlanarState) {
  const cell = Math.min(64, 640 / state.params.columns, 440 / state.params.rows);
  return { cell, x: 450 - state.params.columns * cell / 2, y: 550 };
}
export function gridToStage(state: PlanarState, point: PlanarPoint): PlanarPoint {
  const view = gridLayout(state);
  return { x: view.x + point.x * view.cell, y: view.y - point.y * view.cell };
}
export function gridFromStage(state: PlanarState, point: PlanarPoint): PlanarPoint {
  const view = gridLayout(state);
  return { x: bounded(Math.round((point.x - view.x) / view.cell), 0, state.params.columns), y: bounded(Math.round((view.y - point.y) / view.cell), 0, state.params.rows) };
}
export function tapGridRoute(state: PlanarState, target: string): PlanarState {
  const candidate = routeTargetId(target);
  if (candidate !== null) return selectGridCandidate(state, candidate);
  const road = /^road\.(\d+)_(\d+)\.(\d+)_(\d+)$/.exec(target);
  if (road) return toggleGridRoad(state, { x: Number(road[1]), y: Number(road[2]) }, { x: Number(road[3]), y: Number(road[4]) });
  const node = /^node\.(\d+)_(\d+)$/.exec(target);
  return node ? appendGridVisit(state, { x: Number(node[1]), y: Number(node[2]) }) : state;
}
export function dragGridRoute(start: PlanarState, target: string, at: PlanarPoint, previous = start): PlanarState {
  const point = gridFromStage(start, at);
  if (["start", "end", "required"].includes(target)) return setGridPoint(start, target as "start" | "end" | "required", point);
  if (!target.startsWith("node.")) return start;
  const stage = gridToStage(start, point);
  if (Math.hypot(stage.x - at.x, stage.y - at.y) > gridLayout(start).cell * 0.46) return previous;
  return appendGridVisit(previous, point);
}
export interface GridRouteAnalysis {
  nodes: { point: PlanarPoint; distance: number | null; count: bigint }[];
  distance: number | null; count: bigint; shortest: PlanarPoint[];
}
/** 无权格网按 BFS 求最短距离及条数；必经点作为两层状态，绕行和重复经过道路仍有准确含义。 */
export function gridRouteAnalysis(state: PlanarState): GridRouteAnalysis {
  const key = (point: PlanarPoint, seen: boolean) => `${gridPointKey(point)}.${seen ? 1 : 0}`;
  const startSeen = !state.flags.required || sameGridPoint(state.points.start, state.points.required);
  const first = key(state.points.start, startSeen), queue = [{ point: state.points.start, seen: startSeen, key: first }];
  const distances = new Map([[first, 0]]), counts = new Map([[first, one]]), parents = new Map<string, string>();
  const points = new Map<string, PlanarPoint>([[first, state.points.start]]);
  for (let at = 0; at < queue.length; at++) {
    const current = queue[at], distance = distances.get(current.key)!;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const point = { x: current.point.x + dx, y: current.point.y + dy };
      if (!gridStepAllowed(state, current.point, point)) continue;
      const seen = current.seen || sameGridPoint(point, state.points.required), nextKey = key(point, seen);
      if (!distances.has(nextKey)) {
        distances.set(nextKey, distance + 1); counts.set(nextKey, counts.get(current.key)!); parents.set(nextKey, current.key); points.set(nextKey, point); queue.push({ point, seen, key: nextKey });
      } else if (distances.get(nextKey) === distance + 1) counts.set(nextKey, counts.get(nextKey)! + counts.get(current.key)!);
    }
  }
  const nodes: GridRouteAnalysis["nodes"] = [];
  for (let y = 0; y <= state.params.rows; y++) for (let x = 0; x <= state.params.columns; x++) {
    const point = { x, y }, id = key(point, true);
    nodes.push({ point, distance: distances.get(id) ?? null, count: counts.get(id) ?? zero });
  }
  nodes.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.point.y - b.point.y || a.point.x - b.point.x);
  const end = key(state.points.end, true), shortest: PlanarPoint[] = [];
  if (distances.has(end)) for (let cursor: string | undefined = end; cursor; cursor = parents.get(cursor)) shortest.push(points.get(cursor)!);
  return { nodes, distance: distances.get(end) ?? null, count: counts.get(end) ?? zero, shortest: shortest.reverse() };
}
