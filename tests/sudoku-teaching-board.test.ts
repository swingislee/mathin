import { describe, expect, it } from "vitest";
import { sudokuPuzzle, verifySudoku } from "@/features/games/sudoku/logic";
import {
  SUDOKU_BOX_ELIMINATION_PUZZLE,
  SUDOKU_BOX_ELIMINATION_SEED,
} from "@/features/games/sudoku/presets";
import {
  chooseSudokuDigit,
  createSudokuBoardState,
  deleteSelectedSudokuCell,
  selectSudokuCell,
  setSudokuEntryMode,
  SUDOKU_COLUMN_LABELS,
  SUDOKU_NUMBER_PAD_COLUMNS,
  SUDOKU_ROW_LABELS,
  sudokuCandidateDigits,
  toSudokuMirrorState,
} from "@/features/games/sudoku/state";

const BOX_ELIMINATION_SOLUTION = [
  3, 6, 8, 7, 4, 1, 2, 9, 5,
  1, 9, 7, 2, 6, 5, 3, 8, 4,
  5, 2, 4, 8, 9, 3, 6, 1, 7,
  4, 3, 9, 5, 1, 8, 7, 6, 2,
  2, 8, 5, 3, 7, 6, 9, 4, 1,
  7, 1, 6, 9, 2, 4, 8, 5, 3,
  6, 5, 3, 1, 8, 2, 4, 7, 9,
  9, 4, 1, 6, 3, 7, 5, 2, 8,
  8, 7, 2, 4, 5, 9, 1, 3, 6,
];

describe("Sudoku teaching board M2", () => {
  it("reconstructs the illustrated box-elimination puzzle from its classroom seed", () => {
    const puzzle = sudokuPuzzle(SUDOKU_BOX_ELIMINATION_SEED, "hard");
    const givens = puzzle.flatMap((value, index) =>
      value ? [`${SUDOKU_ROW_LABELS[Math.floor(index / 9)]}${SUDOKU_COLUMN_LABELS[index % 9]}=${value}`] : [],
    );

    expect(puzzle).toEqual([...SUDOKU_BOX_ELIMINATION_PUZZLE]);
    expect(givens).toEqual([
      "A3=8", "A4=7",
      "B3=7", "B4=2", "B9=4",
      "C2=2", "C5=9", "C6=3",
      "D1=4", "D4=5", "D9=2",
      "E3=5", "E5=7", "E7=9",
      "F1=7", "F6=4", "F9=3",
      "G4=1", "G5=8", "G8=7",
      "H1=9", "H6=7", "H7=5",
      "I6=9", "I7=1",
    ]);
    expect(verifySudoku(SUDOKU_BOX_ELIMINATION_SEED, "hard", BOX_ELIMINATION_SOLUTION)).toBe(true);
  });

  it("fixes the coordinate and two-column keypad contract", () => {
    expect(SUDOKU_ROW_LABELS).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
    expect(SUDOKU_COLUMN_LABELS).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(SUDOKU_NUMBER_PAD_COLUMNS).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, null],
    ]);
  });

  it("supports both digit-first and cell-first value input without correctness hints", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);

    state = chooseSudokuDigit(state, puzzle, 9);
    expect(state.inputDigit).toBe(9);
    expect(state.values[0]).toBe(0);

    // A1 的正确答案不是 9；M2 只负责录入，错误判断留给 M4。
    state = selectSudokuCell(state, puzzle, 0);
    expect(state.values[0]).toBe(9);

    state = selectSudokuCell(state, puzzle, 1, false);
    state = chooseSudokuDigit(state, puzzle, 4);
    expect(state.values[1]).toBe(4);

    // A3 是题面给定数，任何输入都不能覆盖。
    state = selectSudokuCell(state, puzzle, 2);
    state = chooseSudokuDigit(state, puzzle, 1);
    expect(state.values[2]).toBe(8);

    const mirror = toSudokuMirrorState(state);
    expect(mirror.inputDigit).toBe(1);
    expect(mirror).not.toHaveProperty("focusedDigit");
  });

  it("toggles candidates, clears them on fill, and mirrors the complete M2 state", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);
    state = setSudokuEntryMode(state, "candidate");
    state = selectSudokuCell(state, puzzle, 1, false);
    state = chooseSudokuDigit(state, puzzle, 4);
    state = chooseSudokuDigit(state, puzzle, 6);

    expect(sudokuCandidateDigits(state.candidates[1])).toEqual([4, 6]);
    state = chooseSudokuDigit(state, puzzle, 4);
    expect(sudokuCandidateDigits(state.candidates[1])).toEqual([6]);

    const mirror = toSudokuMirrorState(state);
    const restored = createSudokuBoardState(puzzle, mirror);
    expect(restored).toEqual(state);

    state = setSudokuEntryMode(state, "value");
    state = chooseSudokuDigit(state, puzzle, 2);
    expect(state.values[1]).toBe(2);
    expect(state.candidates[1]).toBe(0);

    state = deleteSelectedSudokuCell(state, puzzle);
    expect(state.values[1]).toBe(0);
    expect(state.candidates[1]).toBe(0);
    expect(state.inputDigit).toBeNull();
  });
});
