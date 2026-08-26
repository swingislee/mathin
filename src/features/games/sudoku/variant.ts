export const SUDOKU_SIZES = [4, 6, 9] as const;

export type SudokuSize = (typeof SUDOKU_SIZES)[number];

export interface SudokuSpec {
  size: SudokuSize;
  boxRows: number;
  boxColumns: number;
}

const SUDOKU_SPECS: Record<SudokuSize, SudokuSpec> = {
  4: { size: 4, boxRows: 2, boxColumns: 2 },
  6: { size: 6, boxRows: 2, boxColumns: 3 },
  9: { size: 9, boxRows: 3, boxColumns: 3 },
};

const SUDOKU_VARIANT_SEED_PREFIX = "sudoku-v1:";
const SUDOKU_VARIANT_SEED_PATTERN = /^sudoku-v1:(4|6|9):(.*)$/u;

export function isSudokuSize(value: unknown): value is SudokuSize {
  return SUDOKU_SIZES.some((size) => size === value);
}

export function sudokuSpecForSize(size: SudokuSize): SudokuSpec {
  return SUDOKU_SPECS[size];
}

export function sudokuSpecForCellCount(cellCount: number): SudokuSpec | null {
  const size = Math.sqrt(cellCount);
  return isSudokuSize(size) ? sudokuSpecForSize(size) : null;
}

export function sudokuSpecForGrid(grid: readonly number[]): SudokuSpec | null {
  return sudokuSpecForCellCount(grid.length);
}

/**
 * 旧 seed 没有规格字段，必须永久按九宫解释；四宫/六宫只在 seed 内增加版本化标签，
 * 从而继续复用既有 gameId + difficulty + seed + proof 与课堂镜像协议。
 */
export function parseSudokuSeed(seed: string): { size: SudokuSize; baseSeed: string } {
  const match = SUDOKU_VARIANT_SEED_PATTERN.exec(seed);
  if (!match || !match[2]) return { size: 9, baseSeed: seed };
  const size = Number(match[1]);
  return isSudokuSize(size)
    ? { size, baseSeed: match[2] }
    : { size: 9, baseSeed: seed };
}

export function sudokuSizeFromSeed(seed: string): SudokuSize {
  return parseSudokuSeed(seed).size;
}

export function sudokuSeedForSize(seed: string, size: SudokuSize): string {
  const baseSeed = parseSudokuSeed(seed).baseSeed;
  return size === 9 ? baseSeed : `${SUDOKU_VARIANT_SEED_PREFIX}${size}:${baseSeed}`;
}
