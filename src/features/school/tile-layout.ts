import type { TileSize } from "./tiles";

// ---------------------------------------------------------------------------
// 磁贴真二维布局引擎（P4C-4b §5.8a）。纯函数、零依赖，**服务端合并与客户端
// 拖拽共用同一模块**，保证两端消解结果不漂移。坐标系：固定 6 列（lg 基准）、
// 无限行；md 4 列由 reflowToCols 派生，sm 单列按 (y,x) 排序纵排。
// ---------------------------------------------------------------------------

export const GRID_COLS = 6;
export const GRID_COLS_MD = 4;
/** y 上限护栏：防脏数据把布局推到天文行数。 */
export const MAX_Y = 200;

export interface TilePlacement {
  k: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function sizeToWH(size: TileSize): { w: number; h: number } {
  const [w, h] = size.split("x").map(Number);
  return { w, h };
}

/** 在 allowedSizes 里找与 (w,h) 曼哈顿距离最近的档（平手取列表靠前=更接近默认）。 */
export function nearestSize(allowed: readonly TileSize[], w: number, h: number): TileSize {
  let best = allowed[0];
  let bestDist = Infinity;
  for (const size of allowed) {
    const wh = sizeToWH(size);
    const dist = Math.abs(wh.w - w) + Math.abs(wh.h - h);
    if (dist < bestDist) {
      best = size;
      bestDist = dist;
    }
  }
  return best;
}

function overlaps(a: TilePlacement, b: TilePlacement): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** (y,x,k) 稳定序——所有消解都按此序处理，是"确定性 push"的确定性来源。 */
function byPosition(a: TilePlacement, b: TilePlacement): number {
  return a.y - b.y || a.x - b.x || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0);
}

export function sortByPosition(placements: readonly TilePlacement[]): TilePlacement[] {
  return [...placements].sort(byPosition);
}

/**
 * 碰撞消解 + 上浮压实（gridstack push 模型）：
 * 1. lockedKey（拖动/调档中的磁贴）位置不动、最先落位；其余按 (y,x) 序逐个落位，
 *    与已落位者重叠则垂直下推（y++ 直到无重叠）。
 * 2. 压实：非 locked 磁贴反复尝试上移到不重叠为止，消除空洞悬浮。
 * 传 lockedKey=undefined 即全员压实（释放后、服务端归一化用）。
 */
export function resolveLayout(placements: readonly TilePlacement[], lockedKey?: string): TilePlacement[] {
  const sorted = [...placements].sort((a, b) => {
    if (a.k === lockedKey) return -1;
    if (b.k === lockedKey) return 1;
    return byPosition(a, b);
  });
  const placed: TilePlacement[] = [];
  for (const tile of sorted) {
    const next = { ...tile, y: Math.max(0, Math.min(MAX_Y, tile.y)) };
    while (placed.some((other) => overlaps(next, other))) next.y += 1;
    placed.push(next);
  }
  let changed = true;
  while (changed) {
    changed = false;
    placed.sort(byPosition);
    for (const tile of placed) {
      if (tile.k === lockedKey) continue;
      while (tile.y > 0 && !placed.some((other) => other !== tile && overlaps({ ...tile, y: tile.y - 1 }, other))) {
        tile.y -= 1;
        changed = true;
      }
    }
  }
  return placed.sort(byPosition);
}

/**
 * 顺序铺位（**单调**首适应）：默认布局、旧 {k,s} 迁移、移动端重排共用。
 * 每贴从上一贴的行开始扫描，不向前回填空洞——这正是用户反馈③要消除的
 * "小磁贴跳位"来源，保序优先于紧凑，也因此**不做**事后压实。
 */
export function placeSequential(tiles: ReadonlyArray<{ k: string; w: number; h: number }>, cols: number = GRID_COLS): TilePlacement[] {
  const placed: TilePlacement[] = [];
  let scanFrom = 0;
  for (const tile of tiles) {
    const w = Math.min(tile.w, cols);
    let spot: { x: number; y: number } | null = null;
    for (let y = scanFrom; spot === null && y <= MAX_Y; y += 1) {
      for (let x = 0; x + w <= cols; x += 1) {
        const candidate = { k: tile.k, x, y, w, h: tile.h };
        if (!placed.some((other) => overlaps(candidate, other))) {
          spot = { x, y };
          break;
        }
      }
    }
    placed.push({ k: tile.k, x: spot?.x ?? 0, y: spot?.y ?? MAX_Y, w, h: tile.h });
    scanFrom = spot?.y ?? MAX_Y;
  }
  return placed.sort(
    (a, b) => a.y - b.y || a.x - b.x || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0),
  );
}

/** md 4 列派生布局：钳宽/钳 x 后同一例程消解——服务端与客户端算出的结果一致。 */
export function reflowToCols(placements: readonly TilePlacement[], cols: number): TilePlacement[] {
  const clamped = placements.map((tile) => {
    const w = Math.min(tile.w, cols);
    return { ...tile, w, x: Math.max(0, Math.min(tile.x, cols - w)) };
  });
  return resolveLayout(clamped);
}

/**
 * 归一化一份「键已过滤、档已吸附」的布局：钳 x/y → push 消解重叠 → 压实。
 * 服务端 saveDashboardLayout 与 merge 共用（安全边界的最后一步）。
 */
export function normalizePlacements(placements: readonly TilePlacement[], cols: number = GRID_COLS): TilePlacement[] {
  const clamped = placements.map((tile) => {
    const w = Math.max(1, Math.min(tile.w, cols));
    return {
      k: tile.k,
      w,
      h: Math.max(1, tile.h),
      x: Math.max(0, Math.min(Math.trunc(tile.x), cols - w)),
      y: Math.max(0, Math.min(Math.trunc(tile.y), MAX_Y)),
    };
  });
  return resolveLayout(clamped);
}
