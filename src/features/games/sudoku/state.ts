import type {
  GameMirrorState,
  SudokuHighlightTool,
  SudokuTeachingHighlights,
} from "../types";

export type SudokuEntryMode = "candidate" | "value";

export interface SudokuBoardState {
  values: number[];
  /** 每格用 bit 1–9 表示候选数；比 81 个嵌套数组更适合课堂实时镜像。 */
  candidates: number[];
  selected: number | null;
  /** 正常输入数字；M3 的可选「突出数字」会使用独立状态，不复用本字段。 */
  inputDigit: number | null;
  entryMode: SudokuEntryMode;
  highlightTool: SudokuHighlightTool | null;
  highlights: SudokuTeachingHighlights;
}

export const SUDOKU_ROW_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"] as const;
export const SUDOKU_COLUMN_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export const SUDOKU_NUMBER_PAD_COLUMNS = [
  [1, 2, 3, 4, 5],
  [6, 7, 8, 9, null],
] as const;
export const SUDOKU_HIGHLIGHT_TOOLS = [
  "box",
  "row",
  "column",
  "row-block",
  "column-block",
  "digit",
] as const satisfies readonly SudokuHighlightTool[];

const CANDIDATE_MASK = 0b1111111110;

function validDigit(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 9;
}

function validCellIndex(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < 81;
}

function validHighlightTool(value: unknown): value is SudokuHighlightTool {
  return SUDOKU_HIGHLIGHT_TOOLS.some((tool) => tool === value);
}

function normalizedIndexes(value: unknown, max: number): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= max).map(Number))];
}

function emptySudokuHighlights(): SudokuTeachingHighlights {
  return {
    boxes: [],
    rows: [],
    columns: [],
    rowBlocks: [],
    columnBlocks: [],
    focusedDigit: null,
  };
}

function normalizedHighlights(mirror?: GameMirrorState | null): SudokuTeachingHighlights {
  const highlights = mirror?.highlights;
  if (!highlights) return emptySudokuHighlights();
  return {
    boxes: normalizedIndexes(highlights.boxes, 8),
    rows: normalizedIndexes(highlights.rows, 8),
    columns: normalizedIndexes(highlights.columns, 8),
    rowBlocks: normalizedIndexes(highlights.rowBlocks, 26),
    columnBlocks: normalizedIndexes(highlights.columnBlocks, 26),
    focusedDigit: validDigit(highlights.focusedDigit) ? highlights.focusedDigit : null,
  };
}

function normalizedValues(puzzle: number[], mirror?: GameMirrorState | null): number[] {
  if (!mirror || !Array.isArray(mirror.values) || mirror.values.length !== 81) return [...puzzle];
  return puzzle.map((given, index) => {
    if (given) return given;
    const value = mirror.values[index];
    return validDigit(value) ? value : 0;
  });
}

export function createSudokuBoardState(puzzle: number[], mirror?: GameMirrorState | null): SudokuBoardState {
  const values = normalizedValues(puzzle, mirror);
  const candidates = Array.from({ length: 81 }, (_, index) => {
    if (puzzle[index] || values[index]) return 0;
    const mask = mirror?.candidates?.[index];
    return Number.isInteger(mask) && Number(mask) >= 0 ? Number(mask) & CANDIDATE_MASK : 0;
  });

  return {
    values,
    candidates,
    selected: validCellIndex(mirror?.selected) ? mirror.selected : null,
    inputDigit: validDigit(mirror?.inputDigit) ? mirror.inputDigit : null,
    entryMode: mirror?.entryMode === "candidate" ? "candidate" : "value",
    highlightTool: validHighlightTool(mirror?.highlightTool) ? mirror.highlightTool : null,
    highlights: normalizedHighlights(mirror),
  };
}

export function toSudokuMirrorState(state: SudokuBoardState): GameMirrorState {
  return {
    values: [...state.values],
    selected: state.selected,
    candidates: [...state.candidates],
    inputDigit: state.inputDigit,
    entryMode: state.entryMode,
    highlightTool: state.highlightTool,
    highlights: {
      boxes: [...state.highlights.boxes],
      rows: [...state.highlights.rows],
      columns: [...state.highlights.columns],
      rowBlocks: [...state.highlights.rowBlocks],
      columnBlocks: [...state.highlights.columnBlocks],
      focusedDigit: state.highlights.focusedDigit,
    },
  };
}

export function sudokuCandidateDigits(mask: number): number[] {
  return Array.from({ length: 9 }, (_, index) => index + 1).filter((digit) => Boolean(mask & (1 << digit)));
}

function applyDigitAt(state: SudokuBoardState, puzzle: number[], index: number, digit: number): SudokuBoardState {
  if (!validCellIndex(index) || puzzle[index]) return state;

  if (state.entryMode === "candidate") {
    if (state.values[index]) return state;
    const candidates = [...state.candidates];
    candidates[index] ^= 1 << digit;
    return { ...state, candidates };
  }

  const values = [...state.values];
  const candidates = [...state.candidates];
  values[index] = digit;
  candidates[index] = 0;
  return { ...state, values, candidates };
}

/** 数字点选既支持「先格后数」，也保留 inputDigit 供「先数后格」连续讲解。 */
export function chooseSudokuDigit(state: SudokuBoardState, puzzle: number[], digit: number): SudokuBoardState {
  if (!validDigit(digit)) return state;
  if (state.highlightTool === "digit") {
    return {
      ...state,
      highlights: {
        ...state.highlights,
        focusedDigit: state.highlights.focusedDigit === digit ? null : digit,
      },
    };
  }
  if (state.highlightTool) return state;
  const withInput = { ...state, inputDigit: digit };
  return state.selected === null ? withInput : applyDigitAt(withInput, puzzle, state.selected, digit);
}

function toggledIndex(values: number[], value: number): number[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function toggleSudokuHighlightTarget(state: SudokuBoardState, index: number): SudokuBoardState {
  if (!state.highlightTool || !validCellIndex(index)) return state;
  const row = Math.floor(index / 9);
  const column = index % 9;
  const box = Math.floor(row / 3) * 3 + Math.floor(column / 3);

  if (state.highlightTool === "digit") {
    const digit = state.values[index];
    if (!validDigit(digit)) return state;
    return {
      ...state,
      highlights: {
        ...state.highlights,
        focusedDigit: state.highlights.focusedDigit === digit ? null : digit,
      },
    };
  }

  let field: "boxes" | "rows" | "columns" | "rowBlocks" | "columnBlocks";
  let value: number;
  switch (state.highlightTool) {
    case "box":
      field = "boxes";
      value = box;
      break;
    case "row":
      field = "rows";
      value = row;
      break;
    case "column":
      field = "columns";
      value = column;
      break;
    case "row-block":
      field = "rowBlocks";
      value = box * 3 + (row % 3);
      break;
    case "column-block":
      field = "columnBlocks";
      value = box * 3 + (column % 3);
      break;
    default:
      return state;
  }
  return {
    ...state,
    highlights: {
      ...state.highlights,
      [field]: toggledIndex(state.highlights[field], value),
    },
  };
}

export function selectSudokuCell(
  state: SudokuBoardState,
  puzzle: number[],
  index: number,
  applySelectedDigit = true,
): SudokuBoardState {
  if (!validCellIndex(index)) return state;
  if (state.highlightTool) return toggleSudokuHighlightTarget(state, index);
  const withSelection = { ...state, selected: index };
  if (!applySelectedDigit || state.inputDigit === null) return withSelection;
  return applyDigitAt(withSelection, puzzle, index, state.inputDigit);
}

export function setSudokuEntryMode(state: SudokuBoardState, entryMode: SudokuEntryMode): SudokuBoardState {
  if (state.entryMode === entryMode && state.highlightTool === null) return state;
  return { ...state, entryMode, highlightTool: null };
}

export function setSudokuHighlightTool(
  state: SudokuBoardState,
  highlightTool: SudokuHighlightTool,
): SudokuBoardState {
  return {
    ...state,
    highlightTool: state.highlightTool === highlightTool ? null : highlightTool,
  };
}

export function hasSudokuTeachingHighlights(state: SudokuBoardState): boolean {
  const highlights = state.highlights;
  return Boolean(
    state.highlightTool
    || highlights.focusedDigit
    || highlights.boxes.length
    || highlights.rows.length
    || highlights.columns.length
    || highlights.rowBlocks.length
    || highlights.columnBlocks.length,
  );
}

export function clearSudokuTeachingHighlights(state: SudokuBoardState): SudokuBoardState {
  if (!hasSudokuTeachingHighlights(state)) return state;
  return { ...state, highlightTool: null, highlights: emptySudokuHighlights() };
}

export function sudokuCellHighlightCount(
  highlights: SudokuTeachingHighlights,
  row: number,
  column: number,
): number {
  const box = Math.floor(row / 3) * 3 + Math.floor(column / 3);
  return Number(highlights.boxes.includes(box))
    + Number(highlights.rows.includes(row))
    + Number(highlights.columns.includes(column))
    + Number(highlights.rowBlocks.includes(box * 3 + (row % 3)))
    + Number(highlights.columnBlocks.includes(box * 3 + (column % 3)));
}

export function deleteSelectedSudokuCell(state: SudokuBoardState, puzzle: number[]): SudokuBoardState {
  if (state.selected === null || puzzle[state.selected]) {
    return state.inputDigit === null ? state : { ...state, inputDigit: null };
  }
  const values = [...state.values];
  const candidates = [...state.candidates];
  values[state.selected] = 0;
  candidates[state.selected] = 0;
  return { ...state, values, candidates, inputDigit: null };
}
