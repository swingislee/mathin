import { describe, expect, it } from "vitest";
import {
  isSudokuValuePossible,
  solveSudokuGrid,
  sudokuPuzzle,
  verifySudoku,
} from "@/features/games/sudoku/logic";
import {
  SUDOKU_BOX_ELIMINATION_PUZZLE,
  SUDOKU_BOX_ELIMINATION_SEED,
} from "@/features/games/sudoku/presets";
import {
  clearSudokuTeachingHighlights,
  chooseSudokuDigit,
  createSudokuBoardState,
  createSudokuCellHighlightRegion,
  deleteSelectedSudokuCell,
  hasSudokuTeachingHighlights,
  revealSelectedSudokuCell,
  selectSudokuCell,
  setSudokuEntryMode,
  setSudokuHighlightTool,
  SUDOKU_COLUMN_LABELS,
  SUDOKU_HIGHLIGHT_TOOLS,
  SUDOKU_NUMBER_PAD_COLUMNS,
  SUDOKU_ROW_LABELS,
  sudokuCandidateDigits,
  sudokuCellHighlightCount,
  sudokuHighlightRegions,
  toggleSudokuCellHighlightRegion,
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

  it("finds a deterministic legal completion for direct teacher reveal", () => {
    const solution = solveSudokuGrid([...SUDOKU_BOX_ELIMINATION_PUZZLE]);
    expect(solution).toEqual(BOX_ELIMINATION_SOLUTION);
    expect(solution && verifySudoku(SUDOKU_BOX_ELIMINATION_SEED, "hard", solution)).toBe(true);
  });

  it("uses one operation-first value input contract", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);

    state = chooseSudokuDigit(state, puzzle, 3);
    expect(state.inputDigit).toBe(3);
    expect(state.values[0]).toBe(0);

    state = selectSudokuCell(state, puzzle, 0);
    expect(state.values[0]).toBe(3);

    state = selectSudokuCell(state, puzzle, 1, false);
    state = chooseSudokuDigit(state, puzzle, 6);
    expect(state.values[1]).toBe(0);
    expect(state.selected).toBeNull();
    expect(state.inputDigit).toBe(6);

    state = selectSudokuCell(state, puzzle, 1);
    expect(state.values[1]).toBe(6);

    // A3 是题面给定数，任何输入都不能覆盖。
    state = chooseSudokuDigit(state, puzzle, 1);
    state = selectSudokuCell(state, puzzle, 2);
    expect(state.values[2]).toBe(8);

    const mirror = toSudokuMirrorState(state);
    expect(mirror.inputDigit).toBe(1);
    expect(mirror.highlights?.focusedDigit).toBeNull();
  });

  it("switches the persistent digit stamp without rewriting the focused cell", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);

    state = chooseSudokuDigit(state, puzzle, 3);
    state = selectSudokuCell(state, puzzle, 0);
    expect(state.values[0]).toBe(3);
    expect(state.selected).toBe(0);

    state = chooseSudokuDigit(state, puzzle, 6);
    expect(state.values[0]).toBe(3);
    expect(state.selected).toBeNull();
    expect(state.inputDigit).toBe(6);
    expect(state.invalidAttempt).toBeNull();

    state = selectSudokuCell(state, puzzle, 1);
    expect(state.values[1]).toBe(6);
    expect(state.inputDigit).toBe(6);
  });

  it("keeps candidates and the active stamp after a rejected placement", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);

    state = setSudokuEntryMode(state, "candidate");
    state = chooseSudokuDigit(state, puzzle, 3);
    state = selectSudokuCell(state, puzzle, 0);
    state = chooseSudokuDigit(state, puzzle, 6);
    state = selectSudokuCell(state, puzzle, 0);
    expect(sudokuCandidateDigits(state.candidates[0])).toEqual([3, 6]);

    state = setSudokuEntryMode(state, "value");
    state = chooseSudokuDigit(state, puzzle, 2);
    state = selectSudokuCell(state, puzzle, 1);

    expect(state.values[1]).toBe(0);
    expect(state.inputDigit).toBe(2);
    expect(state.selected).toBe(1);
    expect(state.invalidAttempt).toMatchObject({ index: 1, digit: 2 });
    expect(sudokuCandidateDigits(state.candidates[0])).toEqual([3, 6]);

    state = chooseSudokuDigit(state, puzzle, 6);
    expect(state.values[1]).toBe(0);
    expect(state.inputDigit).toBe(6);
    expect(state.selected).toBeNull();
    expect(state.invalidAttempt).toBeNull();
    expect(sudokuCandidateDigits(state.candidates[0])).toEqual([3, 6]);

    state = selectSudokuCell(state, puzzle, 1);
    expect(state.values[1]).toBe(6);
    expect(state.inputDigit).toBe(6);
    expect(sudokuCandidateDigits(state.candidates[0])).toEqual([3, 6]);
  });

  it("toggles candidates, clears them on fill, and mirrors the complete M2 state", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);
    state = setSudokuEntryMode(state, "candidate");
    state = chooseSudokuDigit(state, puzzle, 4);
    state = selectSudokuCell(state, puzzle, 1);
    state = chooseSudokuDigit(state, puzzle, 6);
    state = selectSudokuCell(state, puzzle, 1);

    expect(sudokuCandidateDigits(state.candidates[1])).toEqual([4, 6]);
    state = chooseSudokuDigit(state, puzzle, 4);
    state = selectSudokuCell(state, puzzle, 1);
    expect(sudokuCandidateDigits(state.candidates[1])).toEqual([6]);

    const mirror = toSudokuMirrorState(state);
    const restored = createSudokuBoardState(puzzle, mirror);
    expect(restored).toEqual(state);

    state = setSudokuEntryMode(state, "value");
    state = chooseSudokuDigit(state, puzzle, 6);
    expect(state.values[1]).toBe(0);
    state = selectSudokuCell(state, puzzle, 1);
    expect(state.values[1]).toBe(6);
    expect(state.candidates[1]).toBe(0);

    state = deleteSelectedSudokuCell(state, puzzle);
    expect(state.values[1]).toBe(0);
    expect(state.candidates[1]).toBe(0);
    expect(state.inputDigit).toBeNull();
  });

  it("reveals only the selected empty cell and clears its candidates", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);
    state = setSudokuEntryMode(state, "candidate");
    state = chooseSudokuDigit(state, puzzle, 1);
    state = selectSudokuCell(state, puzzle, 0);

    expect(sudokuCandidateDigits(state.candidates[0])).toEqual([1]);
    state = revealSelectedSudokuCell(state, puzzle);
    expect(state.values[0]).toBe(3);
    expect(state.candidates[0]).toBe(0);
    expect(state.inputDigit).toBeNull();
    expect(state.values.filter(Boolean)).toHaveLength(puzzle.filter(Boolean).length + 1);

    const revealed = state;
    expect(revealSelectedSudokuCell(state, puzzle)).toBe(revealed);
    state = setSudokuHighlightTool(state, "row");
    expect(revealSelectedSudokuCell(state, puzzle)).toBe(state);
  });
});

describe("Sudoku teaching highlights M3", () => {
  it("chooses a matching-digit highlight from the board instead of the number pad", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);

    state = chooseSudokuDigit(state, puzzle, 3);
    expect(state.inputDigit).toBe(3);
    expect(state.highlights.focusedDigit).toBeNull();

    state = setSudokuHighlightTool(state, "digit");
    expect(state.inputDigit).toBeNull();
    state = selectSudokuCell(state, puzzle, 0);
    expect(state.highlights.focusedDigit).toBeNull();

    state = selectSudokuCell(state, puzzle, 3);
    expect(state.highlights.focusedDigit).toBe(7);
    expect(state.values).toEqual(puzzle);

    state = selectSudokuCell(state, puzzle, 3);
    expect(state.highlights.focusedDigit).toBeNull();
  });

  it("keeps digit stamps and highlight tools mutually exclusive", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);

    state = chooseSudokuDigit(state, puzzle, 4);
    state = setSudokuHighlightTool(state, "cell");
    expect(state.inputDigit).toBeNull();
    expect(state.highlightTool).toBe("cell");
    expect(state.selected).toBeNull();

    state = chooseSudokuDigit(state, puzzle, 6);
    expect(state.inputDigit).toBe(6);
    expect(state.highlightTool).toBeNull();

    state = setSudokuHighlightTool(state, "digit");
    state = selectSudokuCell(state, puzzle, 3);
    expect(state.highlights.focusedDigit).toBe(7);
    state = chooseSudokuDigit(state, puzzle, 2);
    expect(state.inputDigit).toBe(2);
    expect(state.highlightTool).toBeNull();
    expect(state.highlights.focusedDigit).toBe(7);

    const restoredLegacyConflict = createSudokuBoardState(puzzle, {
      values: puzzle,
      selected: 0,
      inputDigit: 4,
      highlightTool: "row",
    });
    expect(restoredLegacyConflict.highlightTool).toBe("row");
    expect(restoredLegacyConflict.inputDigit).toBeNull();
    expect(restoredLegacyConflict.selected).toBeNull();
  });

  it("combines a free cell rectangle with box, row and column highlights in any order", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    const e5 = 4 * 9 + 4;
    let state = createSudokuBoardState(puzzle);

    expect(SUDOKU_HIGHLIGHT_TOOLS).toEqual([
      "cell",
      "box",
      "row",
      "column",
      "digit",
    ]);

    state = setSudokuHighlightTool(state, "cell");
    state = toggleSudokuCellHighlightRegion(state, 2 * 9 + 2, 5 * 9 + 6);
    for (const tool of ["box", "row", "column"] as const) {
      state = setSudokuHighlightTool(state, tool);
      state = selectSudokuCell(state, puzzle, e5);
    }

    expect(state.highlights).toMatchObject({
      boxes: [4],
      rows: [4],
      columns: [4],
      regions: [{ top: 2, left: 2, bottom: 5, right: 6 }],
    });
    expect(sudokuCellHighlightCount(state.highlights, 4, 4)).toBe(4);
    expect(sudokuCellHighlightCount(state.highlights, 2, 2)).toBe(1);

    // 反向拖拽会规范化；重复框选同一矩形即取消。
    expect(createSudokuCellHighlightRegion(5 * 9 + 6, 2 * 9 + 2)).toEqual({
      top: 2,
      left: 2,
      bottom: 5,
      right: 6,
    });
    state = setSudokuHighlightTool(state, "cell");
    state = toggleSudokuCellHighlightRegion(state, 5 * 9 + 6, 2 * 9 + 2);
    expect(state.highlights.regions).toEqual([]);
  });

  it("keeps a complete outline rectangle for every freely combined highlight", () => {
    const state = createSudokuBoardState([...SUDOKU_BOX_ELIMINATION_PUZZLE], {
      values: [...SUDOKU_BOX_ELIMINATION_PUZZLE],
      selected: null,
      highlights: {
        boxes: [4],
        rows: [4],
        columns: [4],
        regions: [{ top: 3, left: 2, bottom: 5, right: 6 }],
        focusedDigit: 2,
      },
    });

    expect(sudokuHighlightRegions(state.highlights)).toEqual([
      { key: "box-4", kind: "box", target: 4, rowStart: 4, columnStart: 4, rowSpan: 3, columnSpan: 3 },
      { key: "row-4", kind: "row", target: 4, rowStart: 5, columnStart: 1, rowSpan: 1, columnSpan: 9 },
      { key: "column-4", kind: "column", target: 4, rowStart: 1, columnStart: 5, rowSpan: 9, columnSpan: 1 },
      { key: "cell-3-2-5-6", kind: "cell", target: 0, rowStart: 4, columnStart: 3, rowSpan: 3, columnSpan: 5 },
    ]);
  });

  it("mirrors combined highlights and clears them without touching entries", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);
    state = chooseSudokuDigit(state, puzzle, 3);
    state = selectSudokuCell(state, puzzle, 0);
    state = setSudokuHighlightTool(state, "cell");
    state = toggleSudokuCellHighlightRegion(state, 10, 30);
    state = setSudokuHighlightTool(state, "box");
    state = selectSudokuCell(state, puzzle, 40);
    state = setSudokuHighlightTool(state, "digit");
    state = selectSudokuCell(state, puzzle, 3);

    expect(hasSudokuTeachingHighlights(state)).toBe(true);
    const restored = createSudokuBoardState(puzzle, toSudokuMirrorState(state));
    expect(restored).toEqual(state);

    const valuesBeforeClear = state.values;
    state = clearSudokuTeachingHighlights(state);
    expect(hasSudokuTeachingHighlights(state)).toBe(false);
    expect(state.values).toEqual(valuesBeforeClear);
    expect(state.values[0]).toBe(3);
    expect(state.highlightTool).toBe("digit");
    expect(state.highlights.focusedDigit).toBeNull();
  });

  it("clears only actual highlight marks and keeps the selected teaching tool", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);
    state = setSudokuHighlightTool(state, "cell");

    expect(hasSudokuTeachingHighlights(state)).toBe(false);
    expect(clearSudokuTeachingHighlights(state)).toBe(state);

    state = toggleSudokuCellHighlightRegion(state, 0, 10);
    expect(hasSudokuTeachingHighlights(state)).toBe(true);
    state = clearSudokuTeachingHighlights(state);
    expect(hasSudokuTeachingHighlights(state)).toBe(false);
    expect(state.highlightTool).toBe("cell");
  });

  it("returns to normal input when the teacher chooses Candidates or Fill", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);
    state = setSudokuHighlightTool(state, "row");
    state = selectSudokuCell(state, puzzle, 0);
    state = setSudokuEntryMode(state, "candidate");

    expect(state.highlightTool).toBeNull();
    expect(state.entryMode).toBe("candidate");
    expect(state.highlights.rows).toEqual([0]);
  });
});

describe("Sudoku answer validation M4", () => {
  it("accepts a value only when the resulting board still has a legal completion", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];

    expect(isSudokuValuePossible(puzzle, puzzle, 0, 3)).toBe(true);
    expect(isSudokuValuePossible(puzzle, puzzle, 0, 1)).toBe(false);
  });

  it("rejects wrong values, preserves the stamp, and requires a fresh cell click", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);
    state = chooseSudokuDigit(state, puzzle, 1);
    state = selectSudokuCell(state, puzzle, 0);

    expect(state.values[0]).toBe(0);
    expect(state.inputDigit).toBe(1);
    expect(state.invalidAttempt).toEqual({ index: 0, digit: 1, sequence: 1 });

    const restored = createSudokuBoardState(puzzle, toSudokuMirrorState(state));
    expect(restored).toEqual(state);

    state = chooseSudokuDigit(state, puzzle, 1);
    expect(state.values[0]).toBe(0);
    expect(state.inputDigit).toBe(1);
    expect(state.selected).toBeNull();
    expect(state.invalidAttempt).toBeNull();

    state = chooseSudokuDigit(state, puzzle, 3);
    expect(state.values[0]).toBe(0);
    state = selectSudokuCell(state, puzzle, 0);
    expect(state.values[0]).toBe(3);
    expect(state.inputDigit).toBe(3);
  });

  it("validates digit-first entry but never treats candidates as answer guesses", () => {
    const puzzle = [...SUDOKU_BOX_ELIMINATION_PUZZLE];
    let state = createSudokuBoardState(puzzle);
    state = chooseSudokuDigit(state, puzzle, 1);
    state = selectSudokuCell(state, puzzle, 0);

    expect(state.values[0]).toBe(0);
    expect(state.invalidAttempt).toEqual({ index: 0, digit: 1, sequence: 1 });

    state = setSudokuEntryMode(state, "candidate");
    state = chooseSudokuDigit(state, puzzle, 1);
    state = selectSudokuCell(state, puzzle, 0);
    expect(sudokuCandidateDigits(state.candidates[0])).toEqual([1]);
    expect(state.invalidAttempt).toBeNull();
  });
});
