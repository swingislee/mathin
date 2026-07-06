import { createRng, shuffle } from "../rng";
import type { Difficulty } from "../types";

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

/** 服务端校验：proof 是与该 seed 题面一致的合法终盘（GameDef.verify） */
export function verifySudoku(seed: string, difficulty: Difficulty, proof: unknown): boolean {
  if (!Array.isArray(proof) || proof.length !== 81) return false;
  const grid = proof as SudokuGrid;
  if (!isSolvedGrid(grid)) return false;
  const puzzle = sudokuPuzzle(seed, difficulty);
  return puzzle.every((v, i) => v === 0 || v === grid[i]);
}
