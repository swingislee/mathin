import { createRng, shuffle } from "../rng";
import type { Difficulty } from "../types";
import { sudokuPresetPuzzle } from "./presets";
import {
  parseSudokuVariantSeed,
  resolveSudokuVariant,
  sudokuVariantForGrid,
  type SudokuRuntimeId,
  type SudokuVariantDefinition,
  type SudokuVariantReference,
} from "./variant";

/** 0 = 待填格；数组长度由 variant.size 决定，行优先。 */
export type SudokuGrid = number[];

/**
 * 题型运行时合同：生成、求解、局面判定与服务端验证必须共享同一实现。
 * 新 runtime 的接入步骤见同目录 AGENTS.md；不得只在客户端棋盘增加规则。
 */
export interface SudokuVariantRuntime {
  createPuzzle: (seed: string, difficulty: Difficulty, variant: SudokuVariantDefinition) => SudokuGrid;
  isValidPartial: (values: SudokuGrid, variant: SudokuVariantDefinition) => boolean;
  solve: (values: SudokuGrid, variant: SudokuVariantDefinition) => SudokuGrid | null;
  countSolutions: (values: SudokuGrid, limit: number, variant: SudokuVariantDefinition) => number;
  isSolved: (values: SudokuGrid, variant: SudokuVariantDefinition) => boolean;
  isValuePossible: (
    puzzle: SudokuGrid,
    values: SudokuGrid,
    index: number,
    digit: number,
    variant: SudokuVariantDefinition,
  ) => boolean;
}

function boxStart(pos: number, variant: SudokuVariantDefinition) {
  const row = Math.floor(pos / variant.size);
  const column = pos % variant.size;
  return Math.floor(row / variant.boxRows) * variant.boxRows * variant.size
    + Math.floor(column / variant.boxColumns) * variant.boxColumns;
}

function classicCanPlace(
  grid: SudokuGrid,
  pos: number,
  digit: number,
  variant: SudokuVariantDefinition,
) {
  const row = Math.floor(pos / variant.size) * variant.size;
  const column = pos % variant.size;
  for (let index = 0; index < variant.size; index++) {
    if (grid[row + index] === digit || grid[column + index * variant.size] === digit) return false;
  }
  const box = boxStart(pos, variant);
  for (let index = 0; index < variant.size; index++) {
    const boxRow = Math.floor(index / variant.boxColumns);
    const boxColumn = index % variant.boxColumns;
    if (grid[box + boxRow * variant.size + boxColumn] === digit) return false;
  }
  return true;
}

function classicIsValidPartial(values: SudokuGrid, variant: SudokuVariantDefinition): boolean {
  if (values.length !== variant.size * variant.size) return false;
  const grid = [...values];
  for (let pos = 0; pos < grid.length; pos++) {
    const value = grid[pos];
    if (!Number.isInteger(value) || value < 0 || value > variant.size) return false;
    if (value === 0) continue;
    grid[pos] = 0;
    const valid = classicCanPlace(grid, pos, value, variant);
    grid[pos] = value;
    if (!valid) return false;
  }
  return true;
}

/** 使用最少候选优先的回溯，返回与当前局面相容的一份确定性终盘。 */
function classicSolve(values: SudokuGrid, variant: SudokuVariantDefinition): SudokuGrid | null {
  const grid = [...values];
  if (!classicIsValidPartial(grid, variant)) return null;

  function search(): boolean {
    let target = -1;
    let targetCandidates: number[] = [];

    for (let pos = 0; pos < grid.length; pos++) {
      if (grid[pos] !== 0) continue;
      const candidates = Array.from({ length: variant.size }, (_, index) => index + 1)
        .filter((digit) => classicCanPlace(grid, pos, digit, variant));
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

function classicCountSolutions(
  values: SudokuGrid,
  limit: number,
  variant: SudokuVariantDefinition,
): number {
  if (!Number.isInteger(limit) || limit < 1) return 0;
  const grid = [...values];
  if (!classicIsValidPartial(grid, variant)) return 0;
  let count = 0;

  function search(): void {
    if (count >= limit) return;
    let target = -1;
    let targetCandidates: number[] = [];

    for (let pos = 0; pos < grid.length; pos++) {
      if (grid[pos] !== 0) continue;
      const candidates = Array.from({ length: variant.size }, (_, index) => index + 1)
        .filter((digit) => classicCanPlace(grid, pos, digit, variant));
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

function fillClassicSolved(
  grid: SudokuGrid,
  pos: number,
  rng: () => number,
  variant: SudokuVariantDefinition,
): boolean {
  if (pos === grid.length) return true;
  const digits = shuffle(rng, Array.from({ length: variant.size }, (_, index) => index + 1));
  for (const digit of digits) {
    if (classicCanPlace(grid, pos, digit, variant)) {
      grid[pos] = digit;
      if (fillClassicSolved(grid, pos + 1, rng, variant)) return true;
      grid[pos] = 0;
    }
  }
  return false;
}

function createClassicPuzzle(
  seed: string,
  difficulty: Difficulty,
  variant: SudokuVariantDefinition,
): SudokuGrid {
  const rng = createRng(`sudoku:${difficulty}:${seed}`);
  const cellCount = variant.size * variant.size;
  const grid: SudokuGrid = new Array(cellCount).fill(0);
  fillClassicSolved(grid, 0, rng, variant);
  const holes = shuffle(rng, Array.from({ length: cellCount }, (_, i) => i))
    .slice(0, cellCount - variant.givens[difficulty]);
  for (const pos of holes) grid[pos] = 0;
  return grid;
}

function classicIsSolved(grid: SudokuGrid, variant: SudokuVariantDefinition): boolean {
  if (grid.length !== variant.size * variant.size) return false;
  const boxesPerRow = variant.size / variant.boxColumns;
  const groups = [
    (group: number, index: number) => group * variant.size + index,
    (group: number, index: number) => index * variant.size + group,
    (group: number, index: number) => {
      const boxRow = Math.floor(group / boxesPerRow) * variant.boxRows;
      const boxColumn = (group % boxesPerRow) * variant.boxColumns;
      return (boxRow + Math.floor(index / variant.boxColumns)) * variant.size
        + boxColumn + (index % variant.boxColumns);
    },
  ];
  for (const index of groups) {
    for (let group = 0; group < variant.size; group++) {
      let mask = 0;
      for (let item = 0; item < variant.size; item++) {
        const value = grid[index(group, item)];
        if (!Number.isInteger(value) || value < 1 || value > variant.size) return false;
        mask |= 1 << value;
      }
      if (mask !== (1 << (variant.size + 1)) - 2) return false;
    }
  }
  return true;
}

function classicIsValuePossible(
  puzzle: SudokuGrid,
  values: SudokuGrid,
  index: number,
  digit: number,
  variant: SudokuVariantDefinition,
): boolean {
  if (
    puzzle.length !== variant.size * variant.size
    || values.length !== puzzle.length
    || !Number.isInteger(index)
    || index < 0
    || index >= puzzle.length
    || !Number.isInteger(digit)
    || digit < 1
    || digit > variant.size
    || puzzle[index] !== 0
  ) {
    return false;
  }
  if (!puzzle.every((given, position) => given === 0 || values[position] === given)) return false;

  const attempted = [...values];
  attempted[index] = digit;
  return classicSolve(attempted, variant) !== null;
}

const CLASSIC_LATIN_RUNTIME: SudokuVariantRuntime = {
  createPuzzle: createClassicPuzzle,
  isValidPartial: classicIsValidPartial,
  solve: classicSolve,
  countSolutions: classicCountSolutions,
  isSolved: classicIsSolved,
  isValuePossible: classicIsValuePossible,
};

/**
 * 运行时静态注册表。variant.ts 增加新的 runtimeId 后，本映射会在 typecheck 时要求补实现。
 */
export const SUDOKU_RUNTIME_REGISTRY = {
  "classic-latin-v1": CLASSIC_LATIN_RUNTIME,
} as const satisfies Readonly<Record<SudokuRuntimeId, SudokuVariantRuntime>>;

export function getSudokuVariantRuntime(
  variant: SudokuVariantDefinition,
): SudokuVariantRuntime | null {
  if (!(variant.runtimeId in SUDOKU_RUNTIME_REGISTRY)) return null;
  return SUDOKU_RUNTIME_REGISTRY[variant.runtimeId as SudokuRuntimeId];
}

function variantForGrid(
  values: SudokuGrid,
  reference?: SudokuVariantReference,
): SudokuVariantDefinition | null {
  const variant = reference ? resolveSudokuVariant(reference) : sudokuVariantForGrid(values);
  return variant && values.length === variant.size * variant.size ? variant : null;
}

export function isValidPartialSudokuGrid(
  values: SudokuGrid,
  reference?: SudokuVariantReference,
): boolean {
  const variant = variantForGrid(values, reference);
  const runtime = variant ? getSudokuVariantRuntime(variant) : null;
  return Boolean(variant && runtime?.isValidPartial(values, variant));
}

export function solveSudokuGrid(
  values: SudokuGrid,
  reference?: SudokuVariantReference,
): SudokuGrid | null {
  const variant = variantForGrid(values, reference);
  const runtime = variant ? getSudokuVariantRuntime(variant) : null;
  return variant && runtime ? runtime.solve(values, variant) : null;
}

/** Counts solutions deterministically and stops at `limit` (normally two). */
export function countSudokuSolutions(
  values: SudokuGrid,
  limit = 2,
  reference?: SudokuVariantReference,
): number {
  const variant = variantForGrid(values, reference);
  const runtime = variant ? getSudokuVariantRuntime(variant) : null;
  return variant && runtime ? runtime.countSolutions(values, limit, variant) : 0;
}

export type SudokuPuzzleAnalysis =
  | { status: "conflict" | "unsolvable"; solutionCount: 0; solution: null }
  | { status: "multiple"; solutionCount: 2; solution: null }
  | { status: "unique"; solutionCount: 1; solution: SudokuGrid };

/** Server-authoritative analysis persisted beside every teacher-authored puzzle. */
export function analyzeSudokuPuzzle(
  values: SudokuGrid,
  reference?: SudokuVariantReference,
): SudokuPuzzleAnalysis {
  if (!isValidPartialSudokuGrid(values, reference)) {
    return { status: "conflict", solutionCount: 0, solution: null };
  }
  const solutionCount = countSudokuSolutions(values, 2, reference);
  if (solutionCount === 0) {
    return { status: "unsolvable", solutionCount: 0, solution: null };
  }
  if (solutionCount > 1) {
    return { status: "multiple", solutionCount: 2, solution: null };
  }
  const solution = solveSudokuGrid(values, reference);
  return solution
    ? { status: "unique", solutionCount: 1, solution }
    : { status: "unsolvable", solutionCount: 0, solution: null };
}

/**
 * Returns the only value shared by every completion of one empty cell. A null
 * result means the board is invalid, unsolvable, already filled, or the cell
 * differs across legal completions.
 */
export function forcedSudokuCellValue(
  values: SudokuGrid,
  index: number,
  reference?: SudokuVariantReference,
): number | null {
  const variant = variantForGrid(values, reference);
  const runtime = variant ? getSudokuVariantRuntime(variant) : null;
  if (
    !variant
    || !runtime
    || !Number.isInteger(index)
    || index < 0
    || index >= values.length
    || values[index] !== 0
  ) return null;
  const solution = runtime.solve(values, variant);
  const forcedValue = solution?.[index] ?? 0;
  if (forcedValue < 1 || forcedValue > variant.size) return null;
  for (let digit = 1; digit <= variant.size; digit += 1) {
    if (digit === forcedValue) continue;
    const attempted = [...values];
    attempted[index] = digit;
    if (runtime.solve(attempted, variant)) return null;
  }
  return forcedValue;
}

/**
 * 由 seed 确定性生成题面（服务端校验时以相同 seed 重新生成）。
 * 不保证解唯一：verify 接受任何与题面一致的合法终盘，因此唯一性对反作弊无影响。
 */
export function sudokuPuzzle(seed: string, difficulty: Difficulty): SudokuGrid {
  const preset = sudokuPresetPuzzle(seed);
  if (preset) return preset;
  const parsed = parseSudokuVariantSeed(seed);
  if (!parsed) throw new Error("Unsupported Sudoku variant seed");
  const variant = resolveSudokuVariant(parsed.variantId);
  const runtime = getSudokuVariantRuntime(variant);
  if (!runtime) throw new Error(`Unsupported Sudoku runtime: ${variant.runtimeId}`);
  return runtime.createPuzzle(seed, difficulty, variant);
}

/** 终盘是否满足对应题型 runtime 的全部规则。 */
export function isSolvedGrid(
  grid: SudokuGrid,
  reference?: SudokuVariantReference,
): boolean {
  const variant = variantForGrid(grid, reference);
  const runtime = variant ? getSudokuVariantRuntime(variant) : null;
  return Boolean(variant && runtime?.isSolved(grid, variant));
}

/**
 * M4 逐格验证：接受所有仍可完成为对应题型合法终盘的填数。
 * 这与 verifySudoku 的多解合同一致，不会把另一种合法解误判为错误。
 */
export function isSudokuValuePossible(
  puzzle: SudokuGrid,
  values: SudokuGrid,
  index: number,
  digit: number,
  reference?: SudokuVariantReference,
): boolean {
  const variant = variantForGrid(puzzle, reference);
  const runtime = variant ? getSudokuVariantRuntime(variant) : null;
  return Boolean(variant && runtime?.isValuePossible(puzzle, values, index, digit, variant));
}

/** 服务端校验：proof 是与该 seed 题面一致的合法终盘（GameDef.verify）。 */
export function verifySudoku(seed: string, difficulty: Difficulty, proof: unknown): boolean {
  const parsed = parseSudokuVariantSeed(seed);
  if (!parsed || !Array.isArray(proof)) return false;
  const variant = resolveSudokuVariant(parsed.variantId);
  if (proof.length !== variant.size * variant.size) return false;
  const grid = proof as SudokuGrid;
  if (!isSolvedGrid(grid, variant)) return false;
  try {
    const puzzle = sudokuPuzzle(seed, difficulty);
    return puzzle.every((value, index) => value === 0 || value === grid[index]);
  } catch {
    return false;
  }
}
