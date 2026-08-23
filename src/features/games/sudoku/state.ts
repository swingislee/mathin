import type { GameMirrorState } from "../types";

export type SudokuEntryMode = "candidate" | "value";

export interface SudokuBoardState {
  values: number[];
  /** 每格用 bit 1–9 表示候选数；比 81 个嵌套数组更适合课堂实时镜像。 */
  candidates: number[];
  selected: number | null;
  /** 正常输入数字；M3 的可选「突出数字」会使用独立状态，不复用本字段。 */
  inputDigit: number | null;
  entryMode: SudokuEntryMode;
}

export const SUDOKU_ROW_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"] as const;
export const SUDOKU_COLUMN_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export const SUDOKU_NUMBER_PAD_COLUMNS = [
  [1, 2, 3, 4, 5],
  [6, 7, 8, 9, null],
] as const;

const CANDIDATE_MASK = 0b1111111110;

function validDigit(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 9;
}

function validCellIndex(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < 81;
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
  };
}

export function toSudokuMirrorState(state: SudokuBoardState): GameMirrorState {
  return {
    values: [...state.values],
    selected: state.selected,
    candidates: [...state.candidates],
    inputDigit: state.inputDigit,
    entryMode: state.entryMode,
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
  const withInput = { ...state, inputDigit: digit };
  return state.selected === null ? withInput : applyDigitAt(withInput, puzzle, state.selected, digit);
}

export function selectSudokuCell(
  state: SudokuBoardState,
  puzzle: number[],
  index: number,
  applySelectedDigit = true,
): SudokuBoardState {
  if (!validCellIndex(index)) return state;
  const withSelection = { ...state, selected: index };
  if (!applySelectedDigit || state.inputDigit === null) return withSelection;
  return applyDigitAt(withSelection, puzzle, index, state.inputDigit);
}

export function setSudokuEntryMode(state: SudokuBoardState, entryMode: SudokuEntryMode): SudokuBoardState {
  return state.entryMode === entryMode ? state : { ...state, entryMode };
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
