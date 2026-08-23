import type {
  GameMirrorState,
  SudokuCellHighlightRegion,
  SudokuHighlightTool,
  SudokuInvalidAttempt,
  SudokuTeachingHighlights,
} from "../types";
import { isSudokuValuePossible, solveSudokuGrid } from "./logic";

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
  invalidAttempt: SudokuInvalidAttempt | null;
}

export interface SudokuHighlightRegion {
  key: string;
  kind: Exclude<SudokuHighlightTool, "digit">;
  target: number;
  rowStart: number;
  columnStart: number;
  rowSpan: number;
  columnSpan: number;
}

export const SUDOKU_ROW_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"] as const;
export const SUDOKU_COLUMN_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export const SUDOKU_NUMBER_PAD_COLUMNS = [
  [1, 2, 3, 4, 5],
  [6, 7, 8, 9, null],
] as const;
export const SUDOKU_HIGHLIGHT_TOOLS = [
  "cell",
  "box",
  "row",
  "column",
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

function normalizedCellRegions(value: unknown): SudokuCellHighlightRegion[] {
  if (!Array.isArray(value)) return [];
  const regions = new Map<string, SudokuCellHighlightRegion>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<SudokuCellHighlightRegion>;
    if (
      !Number.isInteger(candidate.top)
      || !Number.isInteger(candidate.left)
      || !Number.isInteger(candidate.bottom)
      || !Number.isInteger(candidate.right)
    ) {
      continue;
    }
    const top = Math.min(Number(candidate.top), Number(candidate.bottom));
    const left = Math.min(Number(candidate.left), Number(candidate.right));
    const bottom = Math.max(Number(candidate.top), Number(candidate.bottom));
    const right = Math.max(Number(candidate.left), Number(candidate.right));
    if (top < 0 || left < 0 || bottom > 8 || right > 8) continue;
    const region = { top, left, bottom, right };
    regions.set(`${top}:${left}:${bottom}:${right}`, region);
  }
  return [...regions.values()];
}

function emptySudokuHighlights(): SudokuTeachingHighlights {
  return {
    boxes: [],
    rows: [],
    columns: [],
    regions: [],
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
    regions: normalizedCellRegions(highlights.regions),
    focusedDigit: validDigit(highlights.focusedDigit) ? highlights.focusedDigit : null,
  };
}

function normalizedInvalidAttempt(mirror?: GameMirrorState | null): SudokuInvalidAttempt | null {
  const attempt = mirror?.invalidAttempt;
  if (
    !attempt
    || !validCellIndex(attempt.index)
    || !validDigit(attempt.digit)
    || !Number.isSafeInteger(attempt.sequence)
    || attempt.sequence < 1
  ) {
    return null;
  }
  return { index: attempt.index, digit: attempt.digit, sequence: attempt.sequence };
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
    invalidAttempt: normalizedInvalidAttempt(mirror),
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
      regions: state.highlights.regions.map((region) => ({ ...region })),
      focusedDigit: state.highlights.focusedDigit,
    },
    invalidAttempt: state.invalidAttempt ? { ...state.invalidAttempt } : null,
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

  if (!isSudokuValuePossible(puzzle, state.values, index, digit)) {
    const previousSequence = state.invalidAttempt?.sequence ?? 0;
    return {
      ...state,
      selected: index,
      inputDigit: null,
      invalidAttempt: {
        index,
        digit,
        sequence: previousSequence >= Number.MAX_SAFE_INTEGER ? 1 : previousSequence + 1,
      },
    };
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

export function createSudokuCellHighlightRegion(
  startIndex: number,
  endIndex: number,
): SudokuCellHighlightRegion | null {
  if (!validCellIndex(startIndex) || !validCellIndex(endIndex)) return null;
  const startRow = Math.floor(startIndex / 9);
  const startColumn = startIndex % 9;
  const endRow = Math.floor(endIndex / 9);
  const endColumn = endIndex % 9;
  return {
    top: Math.min(startRow, endRow),
    left: Math.min(startColumn, endColumn),
    bottom: Math.max(startRow, endRow),
    right: Math.max(startColumn, endColumn),
  };
}

function sameCellRegion(left: SudokuCellHighlightRegion, right: SudokuCellHighlightRegion): boolean {
  return left.top === right.top
    && left.left === right.left
    && left.bottom === right.bottom
    && left.right === right.right;
}

export function toggleSudokuCellHighlightRegion(
  state: SudokuBoardState,
  startIndex: number,
  endIndex: number,
): SudokuBoardState {
  if (state.highlightTool !== "cell") return state;
  const region = createSudokuCellHighlightRegion(startIndex, endIndex);
  if (!region) return state;
  const exists = state.highlights.regions.some((item) => sameCellRegion(item, region));
  return {
    ...state,
    highlights: {
      ...state.highlights,
      regions: exists
        ? state.highlights.regions.filter((item) => !sameCellRegion(item, region))
        : [...state.highlights.regions, region],
    },
  };
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

  if (state.highlightTool === "cell") return toggleSudokuCellHighlightRegion(state, index, index);

  let field: "boxes" | "rows" | "columns";
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
    highlights.focusedDigit
    || highlights.boxes.length
    || highlights.rows.length
    || highlights.columns.length
    || highlights.regions.length,
  );
}

export function clearSudokuTeachingHighlights(state: SudokuBoardState): SudokuBoardState {
  if (!hasSudokuTeachingHighlights(state)) return state;
  return { ...state, highlights: emptySudokuHighlights() };
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
    + highlights.regions.filter((region) => (
      row >= region.top
      && row <= region.bottom
      && column >= region.left
      && column <= region.right
    )).length;
}

/** 把可组合的教学突出转换成 9×9 视觉层上的矩形，保留每个区域自己的完整轮廓。 */
export function sudokuHighlightRegions(highlights: SudokuTeachingHighlights): SudokuHighlightRegion[] {
  const boxOrigin = (box: number) => ({
    rowStart: Math.floor(box / 3) * 3 + 1,
    columnStart: (box % 3) * 3 + 1,
  });

  return [
    ...highlights.boxes.map((box) => ({
      key: `box-${box}`,
      kind: "box" as const,
      target: box,
      ...boxOrigin(box),
      rowSpan: 3,
      columnSpan: 3,
    })),
    ...highlights.rows.map((row) => ({
      key: `row-${row}`,
      kind: "row" as const,
      target: row,
      rowStart: row + 1,
      columnStart: 1,
      rowSpan: 1,
      columnSpan: 9,
    })),
    ...highlights.columns.map((column) => ({
      key: `column-${column}`,
      kind: "column" as const,
      target: column,
      rowStart: 1,
      columnStart: column + 1,
      rowSpan: 9,
      columnSpan: 1,
    })),
    ...highlights.regions.map((region, index) => ({
      key: `cell-${region.top}-${region.left}-${region.bottom}-${region.right}`,
      kind: "cell" as const,
      target: index,
      rowStart: region.top + 1,
      columnStart: region.left + 1,
      rowSpan: region.bottom - region.top + 1,
      columnSpan: region.right - region.left + 1,
    })),
  ];
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

/** 教师快捷动作：只揭示当前选中空格，并沿用当前合法局面的一份终盘。 */
export function revealSelectedSudokuCell(state: SudokuBoardState, puzzle: number[]): SudokuBoardState {
  const index = state.selected;
  if (
    index === null
    || !validCellIndex(index)
    || puzzle[index]
    || state.values[index]
    || state.highlightTool
  ) {
    return state;
  }
  const solution = solveSudokuGrid(state.values);
  const digit = solution?.[index];
  if (!validDigit(digit)) return state;

  const values = [...state.values];
  const candidates = [...state.candidates];
  values[index] = digit;
  candidates[index] = 0;
  return { ...state, values, candidates, inputDigit: null };
}
