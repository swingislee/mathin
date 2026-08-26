import { createRng, shuffle } from "../rng";
import type { Difficulty } from "../types";
import { sudokuPresetPuzzle } from "./presets";

/** 0 = 待填格；数组长度恒为 81，行优先。 */
export type SudokuGrid = number[];

const GIVENS: Record<Difficulty, number> = { easy: 40, medium: 32, hard: 26 };

function boxStart(pos: number) {
  const row = Math.floor(pos / 9);
  const col = pos % 9;
  return Math.floor(row / 3) * 27 + Math.floor(col / 3) * 3;
}

function canPlace(grid: SudokuGrid, pos: number, n: number) {
  const row = Math.floor(pos / 9) * 9;
  const col = pos % 9;
  for (let i = 0; i < 9; i++) {
    if (grid[row + i] === n || grid[col + i * 9] === n) return false;
  }
  const b = boxStart(pos);
  for (let i = 0; i < 9; i++) {
    if (grid[b + Math.floor(i / 3) * 9 + (i % 3)] === n) return false;
  }
  return true;
}

export function isValidPartialSudokuGrid(values: SudokuGrid): boolean {
  const grid = [...values];
  if (grid.length !== 81) return false;
  for (let pos = 0; pos < 81; pos++) {
    const value = grid[pos];
    if (!Number.isInteger(value) || value < 0 || value > 9) return false;
    if (value === 0) continue;
    grid[pos] = 0;
    const valid = canPlace(grid, pos, value);
    grid[pos] = value;
    if (!valid) return false;
  }
  return true;
}

/** 使用最少候选优先的回溯，返回与当前局面相容的一份确定性终盘。 */
export function solveSudokuGrid(values: SudokuGrid): SudokuGrid | null {
  const grid = [...values];
  if (!isValidPartialSudokuGrid(grid)) return null;

  function search(): boolean {
    let target = -1;
    let targetCandidates: number[] = [];

    for (let pos = 0; pos < 81; pos++) {
      if (grid[pos] !== 0) continue;
      const candidates = Array.from({ length: 9 }, (_, index) => index + 1)
        .filter((digit) => canPlace(grid, pos, digit));
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
  const grid = [...values];
  if (!isValidPartialSudokuGrid(grid)) return 0;
  let count = 0;

  function search(): void {
    if (count >= limit) return;
    let target = -1;
    let targetCandidates: number[] = [];

    for (let pos = 0; pos < 81; pos++) {
      if (grid[pos] !== 0) continue;
      const candidates = Array.from({ length: 9 }, (_, index) => index + 1)
        .filter((digit) => canPlace(grid, pos, digit));
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

function fillSolved(grid: SudokuGrid, pos: number, rng: () => number): boolean {
  if (pos === 81) return true;
  const nums = shuffle(rng, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const n of nums) {
    if (canPlace(grid, pos, n)) {
      grid[pos] = n;
      if (fillSolved(grid, pos + 1, rng)) return true;
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
  const rng = createRng(`sudoku:${difficulty}:${seed}`);
  const grid: SudokuGrid = new Array(81).fill(0);
  fillSolved(grid, 0, rng);
  const holes = shuffle(rng, Array.from({ length: 81 }, (_, i) => i)).slice(0, 81 - GIVENS[difficulty]);
  for (const pos of holes) grid[pos] = 0;
  return grid;
}

/** 终盘是否为合法数独（每行/列/宫恰为 1–9） */
export function isSolvedGrid(grid: SudokuGrid): boolean {
  if (grid.length !== 81) return false;
  const groups = [
    (g: number, i: number) => g * 9 + i,                                          // 行
    (g: number, i: number) => i * 9 + g,                                          // 列
    (g: number, i: number) => boxStart(Math.floor(g / 3) * 27 + (g % 3) * 3) + Math.floor(i / 3) * 9 + (i % 3), // 宫
  ];
  for (const index of groups) {
    for (let g = 0; g < 9; g++) {
      let mask = 0;
      for (let i = 0; i < 9; i++) {
        const v = grid[index(g, i)];
        if (!Number.isInteger(v) || v < 1 || v > 9) return false;
        mask |= 1 << v;
      }
      if (mask !== 0b1111111110) return false;
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
  if (
    puzzle.length !== 81
    || values.length !== 81
    || !Number.isInteger(index)
    || index < 0
    || index >= 81
    || !Number.isInteger(digit)
    || digit < 1
    || digit > 9
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
  if (!Array.isArray(proof) || proof.length !== 81) return false;
  const grid = proof as SudokuGrid;
  if (!isSolvedGrid(grid)) return false;
  const puzzle = sudokuPuzzle(seed, difficulty);
  return puzzle.every((v, i) => v === 0 || v === grid[i]);
}
