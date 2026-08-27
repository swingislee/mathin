import { describe, expect, it } from "vitest";
import {
  isSolvedGrid,
  SUDOKU_RUNTIME_REGISTRY,
  solveSudokuGrid,
  sudokuPuzzle,
  verifySudoku,
} from "@/features/games/sudoku/logic";
import {
  chooseSudokuDigit,
  createSudokuBoardState,
  selectSudokuCell,
  setSudokuHighlightTool,
  sudokuCandidateDigits,
  sudokuHighlightRegions,
  sudokuNumberPadItems,
  sudokuNumberPadRowCount,
  toSudokuMirrorState,
} from "@/features/games/sudoku/state";
import {
  parseSudokuVariantSeed,
  parseSudokuSeed,
  SUDOKU_SIZES,
  SUDOKU_VARIANTS,
  sudokuSeedForVariant,
  sudokuSeedForSize,
  sudokuSizeFromSeed,
  sudokuSpecForSize,
  sudokuVariantRegistryIssues,
} from "@/features/games/sudoku/variant";

const EXPECTED_GIVENS = {
  4: { easy: 10, medium: 8, hard: 6 },
  6: { easy: 24, medium: 20, hard: 16 },
  9: { easy: 40, medium: 32, hard: 26 },
} as const;

describe("Sudoku size seed protocol", () => {
  it("keeps every untagged legacy seed as a 9×9 puzzle", () => {
    expect(parseSudokuSeed("legacy-classroom-seed")).toEqual({
      size: 9,
      baseSeed: "legacy-classroom-seed",
    });
    expect(sudokuSizeFromSeed("teaching-box-elimination-01")).toBe(9);
    expect(sudokuSeedForSize("legacy-classroom-seed", 9)).toBe("legacy-classroom-seed");
  });

  it("round-trips 4×4 and 6×6 through the existing seed field", () => {
    expect(sudokuSeedForSize("lesson-a", 4)).toBe("sudoku-v1:4:lesson-a");
    expect(sudokuSeedForSize("lesson-a", 6)).toBe("sudoku-v1:6:lesson-a");
    expect(parseSudokuSeed("sudoku-v1:4:lesson-a")).toEqual({ size: 4, baseSeed: "lesson-a" });
    expect(parseSudokuSeed("sudoku-v1:6:lesson-a")).toEqual({ size: 6, baseSeed: "lesson-a" });
    expect(sudokuSeedForSize("sudoku-v1:4:lesson-a", 6)).toBe("sudoku-v1:6:lesson-a");
    expect(sudokuSeedForSize("sudoku-v1:6:lesson-a", 9)).toBe("lesson-a");
  });

  it("reserves strict v2 variant ids and rejects unknown protocol values", () => {
    expect(parseSudokuVariantSeed("sudoku-v1:6:lesson-a")).toEqual({
      variantId: "classic-6x6",
      size: 6,
      baseSeed: "lesson-a",
      protocol: "v1",
    });
    expect(sudokuSeedForVariant("lesson-a", "classic-4x4")).toBe("sudoku-v1:4:lesson-a");
    expect(parseSudokuVariantSeed("sudoku-v2:future-diagonal:lesson-a")).toBeNull();
    expect(parseSudokuVariantSeed("sudoku-v2:classic-9x9:")).toBeNull();
    expect(verifySudoku("sudoku-v2:future-diagonal:lesson-a", "easy", [])).toBe(false);
  });
});

describe("Sudoku variant extension registry", () => {
  it("keeps metadata valid and every runtime explicitly registered", () => {
    expect(sudokuVariantRegistryIssues()).toEqual([]);
    expect(SUDOKU_VARIANTS.map((variant) => variant.id)).toEqual([
      "classic-4x4",
      "classic-6x6",
      "classic-9x9",
    ]);
    expect(new Set(Object.keys(SUDOKU_RUNTIME_REGISTRY))).toEqual(
      new Set(SUDOKU_VARIANTS.map((variant) => variant.runtimeId)),
    );
  });

  it("keeps ranking and surface policy in variant metadata", () => {
    expect(SUDOKU_VARIANTS.map(({ id, ranked }) => ({ id, ranked }))).toEqual([
      { id: "classic-4x4", ranked: false },
      { id: "classic-6x6", ranked: false },
      { id: "classic-9x9", ranked: true },
    ]);
    expect(SUDOKU_VARIANTS.every((variant) => (
      variant.selectableIn.includes("public")
      && variant.selectableIn.includes("courseware")
      && variant.selectableIn.includes("courseware-authored")
    ))).toBe(true);
  });
});

describe("Sudoku 4×4 / 6×6 / 9×9 generation and verification", () => {
  for (const size of SUDOKU_SIZES) {
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      it(`generates and verifies a deterministic ${size}×${size} ${difficulty} board`, () => {
        const seed = sudokuSeedForSize(`variant-${size}-${difficulty}`, size);
        const puzzle = sudokuPuzzle(seed, difficulty);
        const solution = solveSudokuGrid(puzzle);

        expect(puzzle).toHaveLength(size * size);
        expect(puzzle.filter(Boolean)).toHaveLength(EXPECTED_GIVENS[size][difficulty]);
        expect(Math.max(...puzzle)).toBeLessThanOrEqual(size);
        expect(sudokuPuzzle(seed, difficulty)).toEqual(puzzle);
        expect(solution).not.toBeNull();
        expect(solution && isSolvedGrid(solution)).toBe(true);
        expect(solution && verifySudoku(seed, difficulty, solution)).toBe(true);
      });
    }
  }

  it("uses the standard 2×2, 2×3 and 3×3 box shapes", () => {
    expect(sudokuSpecForSize(4)).toMatchObject({ boxRows: 2, boxColumns: 2 });
    expect(sudokuSpecForSize(6)).toMatchObject({ boxRows: 2, boxColumns: 3 });
    expect(sudokuSpecForSize(9)).toMatchObject({ boxRows: 3, boxColumns: 3 });
  });
});

describe("Sudoku variant teaching state", () => {
  it("limits the keypad, candidates and mirror arrays to the active size", () => {
    expect(sudokuNumberPadRowCount(4)).toBe(3);
    expect(sudokuNumberPadItems(4)).toEqual([1, 2, 3, 4, "spacer", "delete"]);
    expect(sudokuNumberPadItems(6)).toEqual([1, 2, 3, 4, 5, 6, "spacer", "delete"]);
    expect(sudokuNumberPadItems(9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, "delete"]);

    const puzzle = sudokuPuzzle(sudokuSeedForSize("state-six", 6), "easy");
    const emptyIndex = puzzle.findIndex((value) => value === 0);
    let state = createSudokuBoardState(puzzle);
    expect(state.variantId).toBe("classic-6x6");
    const unchanged = chooseSudokuDigit(state, 7);
    expect(unchanged).toBe(state);

    state = setSudokuHighlightTool(state, "cell");
    state = selectSudokuCell(state, puzzle, emptyIndex);
    const mirror = toSudokuMirrorState(state);
    expect(mirror.values).toHaveLength(36);
    expect(mirror.candidates).toHaveLength(36);
    expect(sudokuCandidateDigits((1 << 2) | (1 << 7), 6)).toEqual([2]);
  });

  it("maps six-box highlights to 2×3 regions without changing the mirror shape", () => {
    const puzzle = sudokuPuzzle(sudokuSeedForSize("highlight-six", 6), "medium");
    let state = createSudokuBoardState(puzzle);
    state = setSudokuHighlightTool(state, "box");
    state = selectSudokuCell(state, puzzle, 3 * 6 + 4);

    expect(state.highlights.boxes).toEqual([3]);
    expect(sudokuHighlightRegions(state.highlights, 6)).toEqual([
      {
        key: "box-3",
        kind: "box",
        target: 3,
        rowStart: 3,
        columnStart: 4,
        rowSpan: 2,
        columnSpan: 3,
      },
    ]);
  });
});
