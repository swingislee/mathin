export const COURSEWARE_SNAP_GRID_COLUMNS = 12;
export const COURSEWARE_SNAP_GRID_ROWS = 9;

export interface CoursewareSnapGridPlacement {
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
}

export interface CoursewareSnapGridSize {
  columnSpan: number;
  rowSpan: number;
}

export interface CoursewareSnapGridTile {
  id: string;
  placement: CoursewareSnapGridPlacement;
  minColumnSpan: number;
  minRowSpan: number;
  /** Lower values are packed first when the dragged tile makes several blocks move. */
  priority?: number;
  /** Stable, product-approved fallback sizes; the current size is always tried first. */
  alternativeSizes?: readonly CoursewareSnapGridSize[];
}

export function coursewareSnapGridPlacementsOverlap(
  left: CoursewareSnapGridPlacement,
  right: CoursewareSnapGridPlacement,
): boolean {
  return left.column < right.column + right.columnSpan
    && left.column + left.columnSpan > right.column
    && left.row < right.row + right.rowSpan
    && left.row + left.rowSpan > right.row;
}

function clampPlacement(
  placement: CoursewareSnapGridPlacement,
  tile: CoursewareSnapGridTile,
): CoursewareSnapGridPlacement {
  const columnSpan = Math.max(
    tile.minColumnSpan,
    Math.min(COURSEWARE_SNAP_GRID_COLUMNS, Math.round(placement.columnSpan)),
  );
  const rowSpan = Math.max(
    tile.minRowSpan,
    Math.min(COURSEWARE_SNAP_GRID_ROWS, Math.round(placement.rowSpan)),
  );
  return {
    column: Math.max(0, Math.min(
      COURSEWARE_SNAP_GRID_COLUMNS - columnSpan,
      Math.round(placement.column),
    )),
    row: Math.max(0, Math.min(
      COURSEWARE_SNAP_GRID_ROWS - rowSpan,
      Math.round(placement.row),
    )),
    columnSpan,
    rowSpan,
  };
}

function sizesFor(tile: CoursewareSnapGridTile): CoursewareSnapGridSize[] {
  const seen = new Set<string>();
  const sizes: CoursewareSnapGridSize[] = [];
  for (const size of [
    {
      columnSpan: tile.placement.columnSpan,
      rowSpan: tile.placement.rowSpan,
    },
    ...(tile.alternativeSizes ?? []),
  ]) {
    const columnSpan = Math.max(
      tile.minColumnSpan,
      Math.min(COURSEWARE_SNAP_GRID_COLUMNS, Math.round(size.columnSpan)),
    );
    const rowSpan = Math.max(
      tile.minRowSpan,
      Math.min(COURSEWARE_SNAP_GRID_ROWS, Math.round(size.rowSpan)),
    );
    const key = `${columnSpan}:${rowSpan}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sizes.push({ columnSpan, rowSpan });
  }
  return sizes;
}

function positionsFor(
  size: CoursewareSnapGridSize,
  preferred: CoursewareSnapGridPlacement,
  origin: CoursewareSnapGridPlacement,
): CoursewareSnapGridPlacement[] {
  const candidates: CoursewareSnapGridPlacement[] = [];
  for (let row = 0; row + size.rowSpan <= COURSEWARE_SNAP_GRID_ROWS; row += 1) {
    for (let column = 0; column + size.columnSpan <= COURSEWARE_SNAP_GRID_COLUMNS; column += 1) {
      candidates.push({ column, row, ...size });
    }
  }
  return candidates.sort((left, right) => {
    const leftPreferred = Math.abs(left.column - preferred.column) + Math.abs(left.row - preferred.row);
    const rightPreferred = Math.abs(right.column - preferred.column) + Math.abs(right.row - preferred.row);
    const leftOrigin = Math.abs(left.column - origin.column) + Math.abs(left.row - origin.row);
    const rightOrigin = Math.abs(right.column - origin.column) + Math.abs(right.row - origin.row);
    return leftPreferred - rightPreferred
      || leftOrigin - rightOrigin
      || left.row - right.row
      || left.column - right.column;
  });
}

/**
 * Resolve one direct-manipulation gesture inside the finite 12×9 courseware canvas.
 * The dragged tile is authoritative. Collided tiles first try the dragged tile's
 * previous position (natural swap), then their original/nearest free cells. A
 * product-approved alternative size is used only when the current size cannot fit.
 */
export function resolveCoursewareSnapGridGesture(
  tiles: readonly CoursewareSnapGridTile[],
  lockedId: string,
  desired: CoursewareSnapGridPlacement,
): CoursewareSnapGridPlacement[] | null {
  const locked = tiles.find((tile) => tile.id === lockedId);
  if (!locked) return null;
  const lockedPlacement = clampPlacement(desired, locked);
  const collidedIds = new Set(
    tiles
      .filter((tile) => tile.id !== lockedId)
      .filter((tile) => coursewareSnapGridPlacementsOverlap(tile.placement, lockedPlacement))
      .map((tile) => tile.id),
  );
  const placed = new Map<string, CoursewareSnapGridPlacement>([[lockedId, lockedPlacement]]);
  const remaining = tiles
    .filter((tile) => tile.id !== lockedId)
    .sort((left, right) => (
      (left.priority ?? 10) - (right.priority ?? 10)
      || Number(collidedIds.has(right.id)) - Number(collidedIds.has(left.id))
      || left.placement.row - right.placement.row
      || left.placement.column - right.placement.column
      || left.id.localeCompare(right.id)
    ));

  for (const tile of remaining) {
    const preferred = collidedIds.has(tile.id) ? locked.placement : tile.placement;
    let next: CoursewareSnapGridPlacement | null = null;
    for (const size of sizesFor(tile)) {
      next = positionsFor(size, preferred, tile.placement).find((candidate) => (
        [...placed.values()].every((other) => !coursewareSnapGridPlacementsOverlap(candidate, other))
      )) ?? null;
      if (next) break;
    }
    if (!next) return null;
    placed.set(tile.id, next);
  }

  return tiles.map((tile) => placed.get(tile.id) ?? tile.placement);
}
