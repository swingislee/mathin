/**
 * 首个数独课堂教学题：与用户提供的「宫区块摈除」图示逐格一致。
 * 行使用 A–I，列使用 1–9；0 表示待填格。
 *
 * 继续沿用 game page 的 seed 契约：课堂页仍然离线可重建、无需新增课件类型，
 * 后续题库只需增加 preset seed，而不必把整张题面复制进每个课次快照。
 */
export const SUDOKU_BOX_ELIMINATION_SEED = "teaching-box-elimination-01";

export const SUDOKU_BOX_ELIMINATION_PUZZLE = [
  0, 0, 8, 7, 0, 0, 0, 0, 0,
  0, 0, 7, 2, 0, 0, 0, 0, 4,
  0, 2, 0, 0, 9, 3, 0, 0, 0,
  4, 0, 0, 5, 0, 0, 0, 0, 2,
  0, 0, 5, 0, 7, 0, 9, 0, 0,
  7, 0, 0, 0, 0, 4, 0, 0, 3,
  0, 0, 0, 1, 8, 0, 0, 7, 0,
  9, 0, 0, 0, 0, 7, 5, 0, 0,
  0, 0, 0, 0, 0, 9, 1, 0, 0,
] as const;

export function sudokuPresetPuzzle(seed: string): number[] | null {
  return seed === SUDOKU_BOX_ELIMINATION_SEED ? [...SUDOKU_BOX_ELIMINATION_PUZZLE] : null;
}
