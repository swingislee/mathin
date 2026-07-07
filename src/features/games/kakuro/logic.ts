import { createRng, shuffle } from "../rng";
import type { Difficulty } from "../types";

/**
 * 数和（Kakuro）：模板按难度固定，数字由 seed 确定性填充。
 * '#' = 黑格（承载线索），'.' = 白格；模板保证每段（run）长度 ≥ 2。
 */
const TEMPLATES: Record<Difficulty, string[]> = {
  easy: [
    "#####",
    "#..##",
    "#..##",
    "##..#",
    "##..#",
  ],
  medium: [
    "######",
    "#...##",
    "#....#",
    "#....#",
    "##...#",
  ],
  hard: [
    "#######",
    "#.....#",
    "#.....#",
    "#..#..#",
    "#.....#",
    "#.....#",
  ],
};

export interface KakuroRun {
  /** 段内白格下标（行优先编号） */
  cells: number[];
  /** 线索：段内数字之和 */
  sum: number;
  /** 线索所在黑格下标（水平段在左侧，垂直段在上方） */
  clueAt: number;
  dir: "h" | "v";
}

export interface KakuroPuzzle {
  rows: number;
  cols: number;
  /** true = 黑格 */
  black: boolean[];
  runs: KakuroRun[];
}

function scanRuns(black: boolean[], rows: number, cols: number): Omit<KakuroRun, "sum">[] {
  const runs: Omit<KakuroRun, "sum">[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (black[i]) continue;
      if (c === 0 || black[i - 1]) {
        const cells = [];
        for (let k = c; k < cols && !black[r * cols + k]; k++) cells.push(r * cols + k);
        runs.push({ cells, clueAt: i - 1, dir: "h" });
      }
      if (r === 0 || black[i - cols]) {
        const cells = [];
        for (let k = r; k < rows && !black[k * cols + c]; k++) cells.push(k * cols + c);
        runs.push({ cells, clueAt: i - cols, dir: "v" });
      }
    }
  }
  return runs;
}

/** 回溯填充：每个白格 1–9，段内不重复；解由 rng 洗牌保证随机 */
function fillSolution(black: boolean[], runs: Omit<KakuroRun, "sum">[], rng: () => number): number[] {
  const values = new Array(black.length).fill(0);
  const runsOfCell = new Map<number, number[][]>();
  for (const run of runs) {
    for (const cell of run.cells) {
      if (!runsOfCell.has(cell)) runsOfCell.set(cell, []);
      runsOfCell.get(cell)!.push(run.cells);
    }
  }
  const whites = black.flatMap((b, i) => (b ? [] : [i]));
  const canUse = (cell: number, d: number) =>
    runsOfCell.get(cell)!.every((cells) => cells.every((p) => p === cell || values[p] !== d));
  const fill = (k: number): boolean => {
    if (k === whites.length) return true;
    const cell = whites[k];
    for (const d of shuffle(rng, [1, 2, 3, 4, 5, 6, 7, 8, 9])) {
      if (canUse(cell, d)) {
        values[cell] = d;
        if (fill(k + 1)) return true;
        values[cell] = 0;
      }
    }
    return false;
  };
  fill(0);
  return values;
}

/** 由 seed 确定性生成题面（含各段线索和），服务端校验时以相同 seed 重建 */
export function kakuroPuzzle(seed: string, difficulty: Difficulty): KakuroPuzzle {
  const template = TEMPLATES[difficulty];
  const rows = template.length;
  const cols = template[0].length;
  const black = template.join("").split("").map((ch) => ch === "#");
  const rng = createRng(`kakuro:${difficulty}:${seed}`);
  const bare = scanRuns(black, rows, cols);
  const solution = fillSolution(black, bare, rng);
  const runs = bare.map((run) => ({ ...run, sum: run.cells.reduce((acc, c) => acc + solution[c], 0) }));
  return { rows, cols, black, runs };
}

/** 终盘检查：白格 1–9，各段不重复且和等于线索（黑格必须为 0） */
export function isKakuroSolved(puzzle: KakuroPuzzle, values: number[]): boolean {
  if (values.length !== puzzle.black.length) return false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (puzzle.black[i] ? v !== 0 : !Number.isInteger(v) || v < 1 || v > 9) return false;
  }
  return puzzle.runs.every((run) => {
    const digits = run.cells.map((c) => values[c]);
    return new Set(digits).size === digits.length && digits.reduce((a, b) => a + b, 0) === run.sum;
  });
}

/** 服务端校验（GameDef.verify）：接受任何满足全部线索的合法终盘 */
export function verifyKakuro(seed: string, difficulty: Difficulty, proof: unknown): boolean {
  if (!Array.isArray(proof)) return false;
  return isKakuroSolved(kakuroPuzzle(seed, difficulty), proof as number[]);
}
