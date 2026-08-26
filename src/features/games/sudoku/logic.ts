import { createRng, shuffle } from "../rng";
import type { Difficulty } from "../types";
import { sudokuPresetPuzzle } from "./presets";
import {
  sudokuSizeFromSeed,
  sudokuSpecForGrid,
  sudokuSpecForSize,
  type SudokuSpec,
  type SudokuSize,
} from "./variant";

/** 0 = 待填格；数组长度为 16 / 36 / 81，行优先。 */
export type SudokuGrid = number[];

const GIVENS: Record<SudokuSize, Record<Difficulty, number>> = {
  4: { easy: 10, medium: 8, hard: 6 },
  6: { easy: 24, medium: 20, hard: 16 },
  9: { easy: 40, medium: 32, hard: 26 },
};

function boxStart(pos: number, spec: SudokuSpec) {
  const row = Math.floor(pos / spec.size);
  const column = pos % spec.size;
  return Math.floor(row / spec.boxRows) * spec.boxRows * spec.size
    + Math.floor(column / spec.boxColumns) * spec.boxColumns;
}

function canPlace(grid: SudokuGrid, pos: number, digit: number, spec: SudokuSpec) {
  const row = Math.floor(pos / spec.size) * spec.size;
  const column = pos % spec.size;
  for (let index = 0; index < spec.size; index++) {
    if (grid[row + index] === digit || grid[column + index * spec.size] === digit) return false;
  }
  const box = boxStart(pos, spec);
  for (let index = 0; index < spec.size; index++) {
    const boxRow = Math.floor(index / spec.boxColumns);
    const boxColumn = index % spec.boxColumns;
    if (grid[box + boxRow * spec.size + boxColumn] === digit) return false;
  }
  return true;
}

export function isValidPartialSudokuGrid(values: SudokuGrid): boolean {
  const spec = sudokuSpecForGrid(values);
  if (!spec) return false;
  const grid = [...values];
  for (let pos = 0; pos < grid.length; pos++) {
    const value = grid[pos];
    if (!Number.isInteger(value) || value < 0 || value > spec.size) return false;
    if (value === 0) continue;
    grid[pos] = 0;
    const valid = canPlace(grid, pos, value, spec);
    grid[pos] = value;
    if (!valid) return false;
  }
  return true;
}

/** 使用最少候选优先的回溯，返回与当前局面相容的一份确定性终盘。 */
export function solveSudokuGrid(values: SudokuGrid): SudokuGrid | null {
  const inferredSpec = sudokuSpecForGrid(values);
  if (!inferredSpec) return null;
  const spec = inferredSpec;
  const grid = [...values];
  if (!isValidPartialSudokuGrid(grid)) return null;

  function search(): boolean {
    let target = -1;
    let targetCandidates: number[] = [];

    for (let pos = 0; pos < grid.length; pos++) {
      if (grid[pos] !== 0) continue;
      const candidates = Array.from({ length: spec.size }, (_, index) => index + 1)
        .filter((digit) => canPlace(grid, pos, digit, spec));
      if (candidates.length === 0) return false;
      if (target === -1 || candidates.length < targetCandidates.length) {
        target = pos;
        targetCandidates = candidates;
        if (candidates.length === 1) break;
      }
    }

    if (target === -1) return true;
    for (const digit of targetCandidates) {
      grid[target] = digit;
      if (search()) return true;
    }
    grid[target] = 0;
    return false;
  }

  return search() ? [...grid] : null;
}

/** Counts solutions deterministically and stops at `limit` (normally two). */
export function countSudokuSolutions(values: SudokuGrid, limit = 2): number {
  if (!Number.isInteger(limit) || limit < 1) return 0;
  const inferredSpec = sudokuSpecForGrid(values);
  if (!inferredSpec) return 0;
  const spec = inferredSpec;
  const grid = [...values];
  if (!isValidPartialSudokuGrid(grid)) return 0;
  let count = 0;

  function search(): void {
    if (count >= limit) return;
    let target = -1;
    let targetCandidates: number[] = [];

    for (let pos = 0; pos < grid.length; pos++) {
      if (grid[pos] !== 0) continue;
      const candidates = Array.from({ length: spec.size }, (_, index) => index + 1)
        .filter((digit) => canPlace(grid, pos, digit, spec));
      if (candidates.length === 0) return;
      if (target === -1 || candidates.length < targetCandidates.length) {
        target = pos;
        targetCandidates = candidates;
        if (candidates.length === 1) break;
      }
    }

    if (target === -1) {
      count += 1;
      return;
    }
    for (const digit of targetCandidates) {
      grid[target] = digit;
      search();
      if (count >= limit) break;
    }
    grid[target] = 0;
  }

  search();
  return count;
}

export type SudokuPuzzleAnalysis =
  | { status: "conflict" | "unsolvable"; solutionCount: 0; solution: null }
  | { status: "multiple"; solutionCount: 2; solution: null }
  | { status: "unique"; solutionCount: 1; solution: SudokuGrid };

/** Server-authoritative analysis persisted beside every teacher-authored puzzle. */
export function analyzeSudokuPuzzle(values: SudokuGrid): SudokuPuzzleAnalysis {
  if (!isValidPartialSudokuGrid(values)) {
    return { status: "conflict", solutionCount: 0, solution: null };
  }
  const solutionCount = countSudokuSolutions(values, 2);
  if (solutionCount === 0) {
    return { status: "unsolvable", solutionCount: 0, solution: null };
  }
  if (solutionCount > 1) {
    return { status: "multiple", solutionCount: 2, solution: null };
  }
  const solution = solveSudokuGrid(values);
  return solution
    ? { status: "unique", solutionCount: 1, solution }
    : { status: "unsolvable", solutionCount: 0, solution: null };
}

function hasSudokuSolution(values: SudokuGrid): boolean {
  return solveSudokuGrid(values) !== null;
}

function fillSolved(grid: SudokuGrid, pos: number, rng: () => number, spec: SudokuSpec): boolean {
  if (pos === grid.length) return true;
  const digits = shuffle(rng, Array.from({ length: spec.size }, (_, index) => index + 1));
  for (const digit of digits) {
    if (canPlace(grid, pos, digit, spec)) {
      grid[pos] = digit;
      if (fillSolved(grid, pos + 1, rng, spec)) return true;
      grid[pos] = 0;
    }
  }
  return false;
}

/**
 * 由 seed 确定性生成题面（服务端校验时以相同 seed 重新生成）。
 * 不保证解唯一：verify 接受任何与题面一致的合法终盘，因此唯一性对反作弊无影响。
 */
export function sudokuPuzzle(seed: string, difficulty: Difficulty): SudokuGrid {
  const preset = sudokuPresetPuzzle(seed);
  if (preset) return preset;
  const spec = sudokuSpecForSize(sudokuSizeFromSeed(seed));
  const rng = createRng(`sudoku:${difficulty}:${seed}`);
  const cellCount = spec.size * spec.size;
  const grid: SudokuGrid = new Array(cellCount).fill(0);
  fillSolved(grid, 0, rng, spec);
  const holes = shuffle(rng, Array.from({ length: cellCount }, (_, i) => i))
    .slice(0, cellCount - GIVENS[spec.size][difficulty]);
  for (const pos of holes) grid[pos] = 0;
  return grid;
}

/** 终盘是否为合法数独（每行、列、宫恰好包含 1–N）。 */
export function isSolvedGrid(grid: SudokuGrid): boolean {
  const spec = sudokuSpecForGrid(grid);
  if (!spec) return false;
  const boxesPerRow = spec.size / spec.boxColumns;
  const groups = [
    (group: number, index: number) => group * spec.size + index,
    (group: number, index: number) => index * spec.size + group,
    (group: number, index: number) => {
      const boxRow = Math.floor(group / boxesPerRow) * spec.boxRows;
      const boxColumn = (group % boxesPerRow) * spec.boxColumns;
      return (boxRow + Math.floor(index / spec.boxColumns)) * spec.size
        + boxColumn + (index % spec.boxColumns);
    },
  ];
  for (const index of groups) {
    for (let group = 0; group < spec.size; group++) {
      let mask = 0;
      for (let item = 0; item < spec.size; item++) {
        const v = grid[index(group, item)];
        if (!Number.isInteger(v) || v < 1 || v > spec.size) return false;
        mask |= 1 << v;
      }
      if (mask !== (1 << (spec.size + 1)) - 2) return false;
    }
  }
  return true;
}

/**
 * M4 逐格验证：接受所有仍可完成为合法终盘的填数。
 * 这与 verifySudoku 的多解合同一致，不会把另一种合法解误判为错误。
 */
export function isSudokuValuePossible(
  puzzle: SudokuGrid,
  values: SudokuGrid,
  index: number,
  digit: number,
): boolean {
  const spec = sudokuSpecForGrid(puzzle);
  if (
    !spec
    || values.length !== puzzle.length
    || !Number.isInteger(index)
    || index < 0
    || index >= puzzle.length
    || !Number.isInteger(digit)
    || digit < 1
    || digit > spec.size
    || puzzle[index] !== 0
  ) {
    return false;
  }
  if (!puzzle.every((given, position) => given === 0 || values[position] === given)) return false;

  const attempted = [...values];
  attempted[index] = digit;
  return hasSudokuSolution(attempted);
}

/** 服务端校验：proof 是与该 seed 题面一致的合法终盘（GameDef.verify） */
export function verifySudoku(seed: string, difficulty: Difficulty, proof: unknown): boolean {
  const size = sudokuSizeFromSeed(seed);
  if (!Array.isArray(proof) || proof.length !== size * size) return false;
  const grid = proof as SudokuGrid;
  if (!isSolvedGrid(grid)) return false;
  const puzzle = sudokuPuzzle(seed, difficulty);
  return puzzle.every((v, i) => v === 0 || v === grid[i]);
}
