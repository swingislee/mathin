import type { SquareCell } from "@/features/spatial-math/domain";

export interface CubeNetPlanarTile extends SquareCell {
  readonly id: string;
  readonly quarterTurns: number;
}
export interface CubeNetPlanarStep {
  readonly pivot: SquareCell;
  readonly direction: -1 | 1;
  readonly movingIds: readonly string[];
  readonly from: readonly CubeNetPlanarTile[];
  readonly to: readonly CubeNetPlanarTile[];
}
export interface CubeNetPlanarPlan {
  readonly steps: readonly CubeNetPlanarStep[];
  readonly movingIds: readonly string[];
  readonly target: readonly CubeNetPlanarTile[];
}

const cellKey = (cell: SquareCell) => `${cell.x},${cell.y}`;
const shapeKey = (cells: readonly SquareCell[]) => cells.map(cellKey).sort().join(";");
export function normalizedCubeNetShape(cells: readonly SquareCell[]) {
  const x = Math.min(...cells.map((cell) => cell.x)), y = Math.min(...cells.map((cell) => cell.y));
  return shapeKey(cells.map((cell) => ({ x: cell.x - x, y: cell.y - y })));
}
export function transformCubeNetCell(cell: SquareCell, transform: number): SquareCell {
  let { x, y } = cell;
  if (transform >= 4) x = -x;
  for (let i = 0; i < transform % 4; i++) [x, y] = [-y, x];
  return { x, y };
}
function connected(cells: readonly SquareCell[]) {
  const visited = new Set([0]), queue = [0];
  for (let i = 0; i < queue.length; i++) cells.forEach((cell, index) => {
    const previous = cells[queue[i]];
    if (!visited.has(index) && Math.abs(cell.x - previous.x) + Math.abs(cell.y - previous.y) === 1) { visited.add(index); queue.push(index); }
  });
  return visited.size === cells.length;
}

export function cubeNetPlanarSuccessors(tiles: readonly CubeNetPlanarTile[], fixedIds: ReadonlySet<string> = new Set()): CubeNetPlanarStep[] {
  const neighbors = tiles.map((tile) => tiles.flatMap((other, index) => Math.abs(tile.x - other.x) + Math.abs(tile.y - other.y) === 1 ? [index] : []));
  const result: CubeNetPlanarStep[] = [];
  for (let pivotIndex = 0; pivotIndex < tiles.length; pivotIndex++) for (const first of neighbors[pivotIndex]) {
    const moving = new Set([first]), queue = [first];
    for (let index = 0; index < queue.length; index++) for (const next of neighbors[queue[index]]) {
      if (next === pivotIndex || moving.has(next)) continue;
      moving.add(next); queue.push(next);
    }
    if ([...moving].some((index) => fixedIds.has(tiles[index].id))) continue;
    const support = tiles[pivotIndex], neighbor = tiles[first];
    const dx = neighbor.x - support.x, dy = neighbor.y - support.y;
    const pivots = [
      { x: support.x, y: support.y },
      { x: (support.x + neighbor.x - dy) / 2, y: (support.y + neighbor.y + dx) / 2 },
      { x: (support.x + neighbor.x + dy) / 2, y: (support.y + neighbor.y - dx) / 2 },
    ];
    for (const pivot of pivots) for (const direction of [-1, 1] as const) {
      const to = tiles.map((tile, index) => moving.has(index) ? {
        ...tile, x: pivot.x - direction * (tile.y - pivot.y), y: pivot.y + direction * (tile.x - pivot.x), quarterTurns: tile.quarterTurns + direction,
      } : tile);
      if (new Set(to.map(cellKey)).size !== tiles.length || !connected(to)) continue;
      result.push({ pivot, direction, movingIds: [...moving].map((index) => tiles[index].id), from: tiles, to });
    }
  }
  return result;
}

/** 先在所有连通中间形态中求最少 90° 步数，再在最短路径中保留尽可能多的原位方格。 */
export function planCubeNetPlanarChange(from: readonly CubeNetPlanarTile[], target: readonly SquareCell[]): CubeNetPlanarPlan {
  const targets = new Set(Array.from({ length: 8 }, (_, turn) => normalizedCubeNetShape(target.map((cell) => transformCubeNetCell(cell, turn)))));
  if (targets.has(normalizedCubeNetShape(from))) return { steps: [], movingIds: [], target: from };
  type Route = { tiles: readonly CubeNetPlanarTile[]; steps: readonly CubeNetPlanarStep[] };
  const routes: Route[] = [{ tiles: from, steps: [] }], shapes = new Set([normalizedCubeNetShape(from)]);
  let shortest: Route | null = null;
  for (let index = 0; index < routes.length && !shortest; index++) for (const step of cubeNetPlanarSuccessors(routes[index].tiles)) {
    const key = normalizedCubeNetShape(step.to);
    if (shapes.has(key)) continue;
    shapes.add(key);
    const route = { tiles: step.to, steps: [...routes[index].steps, step] };
    if (targets.has(key)) { shortest = route; break; }
    routes.push(route);
  }
  if (!shortest) throw new Error("CUBE_NET_PLANAR_TRANSITION_UNREACHABLE");
  type Node = { tiles: readonly CubeNetPlanarTile[]; fixed: ReadonlySet<string>; mask: number; previous: number; depth: number; step: CubeNetPlanarStep | null };
  for (let movingCount = 1; movingCount < from.length; movingCount++) {
    const queue: Node[] = [];
    const seen = new Set<string>();
    for (let mask = 1; mask < (1 << from.length); mask++) {
      if (mask.toString(2).replaceAll("0", "").length !== movingCount) continue;
      const fixed = new Set(from.filter((_, index) => !(mask & (1 << index))).map((tile) => tile.id));
      queue.push({ tiles: from, fixed, mask, previous: -1, depth: 0, step: null });
      seen.add(`${mask}|${shapeKey(from)}`);
    }
    for (let index = 0; index < queue.length; index++) {
      const node = queue[index];
      if (node.depth >= shortest.steps.length) continue;
      for (const step of cubeNetPlanarSuccessors(node.tiles, node.fixed)) {
        const key = `${node.mask}|${shapeKey(step.to)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (targets.has(normalizedCubeNetShape(step.to))) {
          const steps = [step];
          for (let previous = index; queue[previous].step; previous = queue[previous].previous) steps.unshift(queue[previous].step!);
          return { steps, movingIds: [...new Set(steps.flatMap((item) => item.movingIds))], target: step.to };
        }
        queue.push({ tiles: step.to, fixed: node.fixed, mask: node.mask, previous: index, depth: node.depth + 1, step });
      }
    }
  }
  return { steps: shortest.steps, movingIds: [...new Set(shortest.steps.flatMap((step) => step.movingIds))], target: shortest.tiles };
}

/** 方格绕相邻方格中心或共同顶点在纸面内转动；这是形态变换演示，与三维折纸手势分别表达。 */
export function sampleCubeNetPlanarStep(step: CubeNetPlanarStep, progress: number) {
  const t = Math.min(1, Math.max(0, progress));
  const eased = t * t * (3 - 2 * t);
  const angle = step.direction * eased * Math.PI / 2;
  return step.from.map((tile) => step.movingIds.includes(tile.id) ? {
    ...tile,
    x: step.pivot.x + (tile.x - step.pivot.x) * Math.cos(angle) - (tile.y - step.pivot.y) * Math.sin(angle),
    y: step.pivot.y + (tile.x - step.pivot.x) * Math.sin(angle) + (tile.y - step.pivot.y) * Math.cos(angle),
    quarterTurns: tile.quarterTurns + step.direction * eased,
  } : tile);
}
