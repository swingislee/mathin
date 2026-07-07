import { createRng, randInt, shuffle } from "../rng";
import type { Difficulty } from "../types";

/**
 * 幻方：在 n×n 棋盘填入 1–n²，使每行、每列与两条对角线之和都等于幻和。
 * 由基础幻方 + 随机对称变换（+ 补数变换）派生题目，seed 确定性。
 */
const LO_SHU = [2, 7, 6, 9, 5, 1, 4, 3, 8];
const DURER = [16, 3, 2, 13, 5, 10, 11, 8, 9, 6, 7, 12, 4, 15, 14, 1];

const SIZE: Record<Difficulty, number> = { easy: 3, medium: 4, hard: 4 };
const GIVENS: Record<Difficulty, number> = { easy: 3, medium: 6, hard: 3 };

export interface MagicPuzzle {
  n: number;
  /** 0 = 待填格 */
  givens: number[];
  magicSum: number;
}

/** 8 种对称之一 */
function applySymmetry(base: number[], n: number, sym: number): number[] {
  const out = new Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const [rr, cc] = [
        [r, c], [c, n - 1 - r], [n - 1 - r, n - 1 - c], [n - 1 - c, r],
        [r, n - 1 - c], [n - 1 - r, c], [c, r], [n - 1 - c, n - 1 - r],
      ][sym];
      out[r * n + c] = base[rr * n + cc];
    }
  }
  return out;
}

function solvedSquare(seed: string, difficulty: Difficulty): { n: number; grid: number[] } {
  const n = SIZE[difficulty];
  const rng = createRng(`magic:${difficulty}:${seed}`);
  let grid = applySymmetry(n === 3 ? LO_SHU : DURER, n, randInt(rng, 8));
  // 补数变换 x → n²+1−x 仍是幻方
  if (rng() < 0.5) grid = grid.map((v) => n * n + 1 - v);
  return { n, grid };
}

export function magicPuzzle(seed: string, difficulty: Difficulty): MagicPuzzle {
  const { n, grid } = solvedSquare(seed, difficulty);
  const rng = createRng(`magic-holes:${difficulty}:${seed}`);
  const keep = new Set(shuffle(rng, Array.from({ length: n * n }, (_, i) => i)).slice(0, GIVENS[difficulty]));
  return {
    n,
    givens: grid.map((v, i) => (keep.has(i) ? v : 0)),
    magicSum: (n * (n * n + 1)) / 2,
  };
}

/** 终盘检查：1–n² 恰各一次，行/列/对角线全部等于幻和 */
export function isMagicSolved(n: number, values: number[]): boolean {
  if (values.length !== n * n) return false;
  const seen = new Set(values);
  if (seen.size !== n * n || values.some((v) => !Number.isInteger(v) || v < 1 || v > n * n)) return false;
  const target = (n * (n * n + 1)) / 2;
  let d1 = 0;
  let d2 = 0;
  for (let i = 0; i < n; i++) {
    let row = 0;
    let col = 0;
    for (let j = 0; j < n; j++) {
      row += values[i * n + j];
      col += values[j * n + i];
    }
    if (row !== target || col !== target) return false;
    d1 += values[i * n + i];
    d2 += values[i * n + (n - 1 - i)];
  }
  return d1 === target && d2 === target;
}

/** 服务端校验（GameDef.verify）：合法幻方且与题面 givens 一致 */
export function verifyMagic(seed: string, difficulty: Difficulty, proof: unknown): boolean {
  if (!Array.isArray(proof)) return false;
  const values = proof as number[];
  const puzzle = magicPuzzle(seed, difficulty);
  if (!isMagicSolved(puzzle.n, values)) return false;
  return puzzle.givens.every((v, i) => v === 0 || v === values[i]);
}
