"use client";

import {
  Columns3,
  Eraser,
  Hash,
  MoveHorizontal,
  MoveVertical,
  RotateCcw,
  Rows3,
  SquareDashed,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { GameBoardProps, GameMirrorState, SudokuHighlightTool } from "../types";
import { isSolvedGrid, sudokuPuzzle } from "./logic";
import styles from "./SudokuBoard.module.css";
import {
  clearSudokuTeachingHighlights,
  chooseSudokuDigit,
  createSudokuBoardState,
  deleteSelectedSudokuCell,
  hasSudokuTeachingHighlights,
  selectSudokuCell,
  setSudokuEntryMode,
  setSudokuHighlightTool,
  SUDOKU_COLUMN_LABELS,
  SUDOKU_NUMBER_PAD_COLUMNS,
  SUDOKU_ROW_LABELS,
  sudokuCandidateDigits,
  sudokuCellHighlightCount,
  toSudokuMirrorState,
  type SudokuBoardState,
  type SudokuEntryMode,
} from "./state";

const ENTRY_MODES: SudokuEntryMode[] = ["candidate", "value"];
const INVALID_CELL_VISIBLE_MS = 1_100;
const INVALID_MESSAGE_DELAY_MS = 440;
const INVALID_MESSAGE_VISIBLE_MS = 2_600;
const HIGHLIGHT_TOOL_DEFS = [
  { tool: "box", label: "highlightBox", Icon: SquareDashed },
  { tool: "row", label: "highlightRow", Icon: Rows3 },
  { tool: "column", label: "highlightColumn", Icon: Columns3 },
  { tool: "row-block", label: "highlightRowBlock", Icon: MoveHorizontal },
  { tool: "column-block", label: "highlightColumnBlock", Icon: MoveVertical },
  { tool: "digit", label: "highlightDigit", Icon: Hash },
] as const satisfies ReadonlyArray<{
  tool: SudokuHighlightTool;
  label: "highlightBox" | "highlightRow" | "highlightColumn" | "highlightRowBlock" | "highlightColumnBlock" | "highlightDigit";
  Icon: typeof SquareDashed;
}>;

export function SudokuBoard({ seed, difficulty, finished, onComplete, mirror, onMirror, readOnly }: GameBoardProps) {
  const t = useTranslations("games.sudokuBoard");
  const puzzleKey = `${seed}:${difficulty}`;
  const puzzle = useMemo(() => sudokuPuzzle(seed, difficulty), [seed, difficulty]);
  const [state, setState] = useState<SudokuBoardState>(() => createSudokuBoardState(puzzle, mirror));
  const [appliedMirror, setAppliedMirror] = useState<GameMirrorState | null | undefined>(mirror);
  const [appliedPuzzleKey, setAppliedPuzzleKey] = useState(puzzleKey);
  const invalidAttemptKey = state.invalidAttempt
    ? `${puzzleKey}:${state.invalidAttempt.sequence}`
    : null;
  const invalidAttemptIndex = state.invalidAttempt?.index ?? null;
  const [invalidCell, setInvalidCell] = useState<number | null>(null);
  const [reasoningVisible, setReasoningVisible] = useState(false);
  const seenInvalidAttempt = useRef(invalidAttemptKey);
  const reasoningOnlyMessage = t("reasoningOnly");

  useEffect(() => {
    if (!invalidAttemptKey || invalidAttemptIndex === null) {
      seenInvalidAttempt.current = null;
      const clearTimer = window.setTimeout(() => {
        setInvalidCell(null);
        setReasoningVisible(false);
      }, 0);
      return () => window.clearTimeout(clearTimer);
    }
    if (seenInvalidAttempt.current === invalidAttemptKey) return;
    seenInvalidAttempt.current = invalidAttemptKey;

    const resetTimer = window.setTimeout(() => {
      setInvalidCell(null);
      setReasoningVisible(false);
    }, 0);
    const animationTimer = window.setTimeout(() => setInvalidCell(invalidAttemptIndex), 20);
    const messageTimer = window.setTimeout(() => setReasoningVisible(true), INVALID_MESSAGE_DELAY_MS);
    const clearCellTimer = window.setTimeout(() => setInvalidCell(null), INVALID_CELL_VISIBLE_MS);
    const clearMessageTimer = window.setTimeout(
      () => setReasoningVisible(false),
      INVALID_MESSAGE_DELAY_MS + INVALID_MESSAGE_VISIBLE_MS,
    );

    return () => {
      window.clearTimeout(resetTimer);
      window.clearTimeout(animationTimer);
      window.clearTimeout(messageTimer);
      window.clearTimeout(clearCellTimer);
      window.clearTimeout(clearMessageTimer);
    };
  }, [invalidAttemptIndex, invalidAttemptKey]);

  // 课堂镜像：新状态对象到达即在渲染期对齐本地（React「adjust state during render」模式）。
  if (puzzleKey !== appliedPuzzleKey) {
    setAppliedPuzzleKey(puzzleKey);
    setAppliedMirror(mirror);
    setState(createSudokuBoardState(puzzle, mirror));
  } else if (mirror !== appliedMirror) {
    setAppliedMirror(mirror);
    if (mirror) setState(createSudokuBoardState(puzzle, mirror));
  }

  const inputDisabled = Boolean(readOnly || finished);
  const digitHighlightMode = state.highlightTool === "digit";
  const numberPadDisabled = inputDisabled || Boolean(state.highlightTool && !digitHighlightMode);
  const deleteDisabled = inputDisabled || Boolean(state.highlightTool);

  function commit(next: SudokuBoardState) {
    if (next === state) return;
    setState(next);
    onMirror?.(toSudokuMirrorState(next));
    if (next.values !== state.values && next.values.every((value) => value > 0) && isSolvedGrid(next.values)) {
      onComplete(next.values);
    }
  }

  function chooseDigit(digit: number) {
    if (inputDisabled) return;
    commit(chooseSudokuDigit(state, puzzle, digit));
  }

  function selectCell(index: number, applySelectedDigit = true) {
    if (inputDisabled) return;
    commit(selectSudokuCell(state, puzzle, index, applySelectedDigit));
  }

  function deleteEntry() {
    if (deleteDisabled) return;
    commit(deleteSelectedSudokuCell(state, puzzle));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (inputDisabled) return;
    if (event.key >= "1" && event.key <= "9") {
      event.preventDefault();
      chooseDigit(Number(event.key));
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
      event.preventDefault();
      deleteEntry();
      return;
    }
    if (state.highlightTool) return;
    if (state.selected === null) return;

    const row = Math.floor(state.selected / 9);
    const column = state.selected % 9;
    const target = {
      ArrowLeft: column > 0 ? state.selected - 1 : null,
      ArrowRight: column < 8 ? state.selected + 1 : null,
      ArrowUp: row > 0 ? state.selected - 9 : null,
      ArrowDown: row < 8 ? state.selected + 9 : null,
    }[event.key];
    if (typeof target === "number") {
      event.preventDefault();
      selectCell(target, false);
    }
  }

  return (
    <div
      aria-label={t("boardLabel")}
      className={cn(
        styles.academyTheme,
        "relative mx-auto h-full w-full overflow-auto rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--sudoku-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
      )}
      tabIndex={inputDisabled ? -1 : 0}
      onKeyDown={onKeyDown}
    >
      {reasoningVisible ? (
        <div aria-live="assertive" className={styles.reasoningPrompt} role="alert">
          {reasoningOnlyMessage}
        </div>
      ) : null}
      <div className="mx-auto grid h-full min-h-96 min-w-[38rem] max-w-5xl grid-cols-[minmax(9.5rem,10.5rem)_minmax(0,1fr)] items-center gap-4 p-1 sm:gap-6">
        <aside className="grid w-full max-w-[10.5rem] grid-cols-[minmax(0,7.25rem)_2.75rem] items-center gap-2 justify-self-center">
          <div className="flex min-w-0 flex-col gap-3">
            <div
              aria-label={t("entryMode")}
              className={cn(styles.controlGroup, "grid grid-cols-2 rounded-xl border p-1")}
              role="radiogroup"
            >
              {ENTRY_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={state.entryMode === mode && state.highlightTool === null}
                  disabled={inputDisabled}
                  onClick={() => commit(setSudokuEntryMode(state, mode))}
                  className={cn(
                    styles.modeButton,
                    "min-h-10 rounded-lg border border-transparent px-1 text-sm font-medium transition-colors disabled:cursor-default disabled:opacity-100",
                    state.entryMode === mode && state.highlightTool === null
                      ? styles.controlActive
                      : styles.controlIdle,
                  )}
                >
                  {t(mode === "candidate" ? "candidateMode" : "valueMode")}
                </button>
              ))}
            </div>

            <div aria-label={t("numberPad")} className="grid grid-cols-2 gap-2" role="group">
              {SUDOKU_NUMBER_PAD_COLUMNS.map((column, columnIndex) => (
                <div key={columnIndex} className="flex flex-col gap-2">
                  {column.map((digit) => {
                    if (digit === null) {
                      return (
                        <button
                          key="delete"
                          type="button"
                          aria-label={t("deleteEntry")}
                          title={t("deleteEntry")}
                          disabled={deleteDisabled}
                          onClick={deleteEntry}
                          className={cn(
                            styles.numberButton,
                            "grid aspect-square min-h-11 w-full place-items-center rounded-xl border transition-colors disabled:cursor-default disabled:opacity-45",
                          )}
                        >
                          <Eraser aria-hidden size={20} />
                        </button>
                      );
                    }
                    const pressed = digitHighlightMode
                      ? state.highlights.focusedDigit === digit
                      : state.inputDigit === digit;
                    return (
                      <button
                        key={digit}
                        type="button"
                        aria-label={t(digitHighlightMode ? "highlightDigitChoice" : "chooseDigit", { digit })}
                        aria-pressed={pressed}
                        disabled={numberPadDisabled}
                        onClick={() => chooseDigit(digit)}
                        className={cn(
                          styles.numberButton,
                          "aspect-square min-h-11 w-full rounded-xl border text-xl font-medium tabular-nums transition-colors disabled:cursor-default disabled:opacity-45",
                          pressed && digitHighlightMode && styles.numberHighlightActive,
                          pressed && !digitHighlightMode && styles.numberActive,
                        )}
                      >
                        {digit}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div
            aria-label={t("highlightToolbar")}
            className={cn(styles.toolBar, "flex flex-col items-center gap-1.5 rounded-xl border p-1")}
            role="toolbar"
          >
            {HIGHLIGHT_TOOL_DEFS.map(({ tool, label, Icon }) => (
              <button
                key={tool}
                type="button"
                aria-label={t(label)}
                aria-pressed={state.highlightTool === tool}
                title={t(label)}
                disabled={inputDisabled}
                onClick={() => commit(setSudokuHighlightTool(state, tool))}
                className={cn(
                  styles.toolButton,
                  "grid size-11 shrink-0 place-items-center rounded-lg border transition-colors disabled:cursor-default disabled:opacity-100",
                  state.highlightTool === tool
                    ? styles.toolActive
                    : styles.controlIdle,
                )}
              >
                <Icon aria-hidden size={18} />
              </button>
            ))}
            <span aria-hidden className={cn(styles.toolSeparator, "h-px w-7")} />
            <button
              type="button"
              aria-label={t("clearHighlights")}
              title={t("clearHighlights")}
              disabled={inputDisabled || !hasSudokuTeachingHighlights(state)}
              onClick={() => commit(clearSudokuTeachingHighlights(state))}
              className={cn(
                styles.toolButton,
                styles.controlIdle,
                "grid size-11 shrink-0 place-items-center rounded-lg border transition-colors disabled:cursor-default disabled:opacity-35",
              )}
            >
              <RotateCcw aria-hidden size={18} />
            </button>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 items-center justify-center self-stretch">
          <div className="grid aspect-square h-auto max-h-full w-full max-w-[42rem] grid-cols-[1.125rem_minmax(0,1fr)] grid-rows-[1.125rem_minmax(0,1fr)]">
            <span aria-hidden />
            <div aria-hidden className={cn(styles.coordinate, "grid grid-cols-9 text-xs font-medium sm:text-sm")}>
              {SUDOKU_COLUMN_LABELS.map((label) => (
                <span key={label} className="grid place-items-center tabular-nums">{label}</span>
              ))}
            </div>
            <div aria-hidden className={cn(styles.coordinate, "grid grid-rows-9 text-xs font-medium sm:text-sm")}>
              {SUDOKU_ROW_LABELS.map((label) => (
                <span key={label} className="grid place-items-center">{label}</span>
              ))}
            </div>
            <div className={cn(styles.boardGrid, "grid grid-cols-9 overflow-hidden rounded-xl border-2")}>
              {state.values.map((value, index) => {
                const given = puzzle[index] !== 0;
                const column = index % 9;
                const row = Math.floor(index / 9);
                const box = Math.floor(row / 3) * 3 + Math.floor(column / 3);
                const coordinate = `${SUDOKU_ROW_LABELS[row]}${SUDOKU_COLUMN_LABELS[column]}`;
                const candidateDigits = sudokuCandidateDigits(state.candidates[index]);
                const structuralHighlightCount = sudokuCellHighlightCount(state.highlights, row, column);
                const digitHighlighted = Boolean(value && state.highlights.focusedDigit === value);
                const teachingHighlighted = structuralHighlightCount > 0 || digitHighlighted;
                const invalid = invalidCell === index;
                const baseLabel = given
                  ? t("givenCell", { coordinate, value })
                  : value
                    ? t("filledCell", { coordinate, value })
                    : candidateDigits.length
                      ? t("candidateCell", { coordinate, values: candidateDigits.join(" ") })
                      : t("emptyCell", { coordinate });
                const label = teachingHighlighted ? `${baseLabel}${t("highlightedSuffix")}` : baseLabel;
                const greenBox = (Math.floor(row / 3) + Math.floor(column / 3)) % 2 === 0;

                return (
                  <button
                    key={coordinate}
                    type="button"
                    aria-label={label}
                    aria-pressed={state.selected === index}
                    disabled={inputDisabled}
                    data-box={box + 1}
                    data-column={column + 1}
                    data-coordinate={coordinate}
                    data-digit={value || undefined}
                    data-given={given || undefined}
                    data-highlight-count={structuralHighlightCount || undefined}
                    data-invalid-attempt={invalid || undefined}
                    data-row={SUDOKU_ROW_LABELS[row]}
                    data-teaching-highlight={teachingHighlighted || undefined}
                    onClick={() => selectCell(index)}
                    className={cn(
                      styles.cell,
                      "relative flex aspect-square items-center justify-center tabular-nums outline-none transition-[background-color,filter,box-shadow] duration-100 disabled:cursor-default disabled:opacity-100",
                      greenBox ? styles.greenCell : styles.blueCell,
                      column < 8 && (column % 3 === 2 ? styles.majorRight : styles.minorRight),
                      row < 8 && (row % 3 === 2 ? styles.majorBottom : styles.minorBottom),
                      structuralHighlightCount === 1 && styles.highlightSingle,
                      structuralHighlightCount > 1 && styles.highlightOverlap,
                      !inputDisabled && "hover:brightness-[0.97]",
                      state.highlightTool && !inputDisabled && "cursor-crosshair",
                      state.selected === index && state.highlightTool === null && styles.selectedCell,
                      invalid && styles.invalidCell,
                    )}
                  >
                    {value ? (
                      <span
                        className={cn(
                          "text-[clamp(1rem,3vw,2rem)] leading-none",
                          given ? cn(styles.givenTile, "font-semibold") : cn(styles.filledDigit, "font-medium"),
                          digitHighlighted && styles.digitHighlight,
                        )}
                      >
                        {value}
                      </span>
                    ) : candidateDigits.length ? (
                      <span
                        aria-hidden
                        className={cn(
                          styles.candidateGrid,
                          "grid size-full grid-cols-3 grid-rows-3 p-[5%] text-[clamp(0.48rem,1.2vw,0.72rem)] leading-none",
                        )}
                      >
                        {Array.from({ length: 9 }, (_, candidateIndex) => candidateIndex + 1).map((digit) => (
                          <span
                            key={digit}
                            className={cn(
                              "grid place-items-center rounded-full",
                              candidateDigits.includes(digit)
                              && state.highlights.focusedDigit === digit
                              && styles.candidateFocused,
                            )}
                          >
                            {candidateDigits.includes(digit) ? digit : ""}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
