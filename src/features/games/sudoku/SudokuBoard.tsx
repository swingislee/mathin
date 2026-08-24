"use client";

import {
  Columns3,
  Eraser,
  Eye,
  Hash,
  Rows3,
  Scan,
  SquareDashed,
  Trash2,
  Undo2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import type { GameBoardProps, GameMirrorState, SudokuHighlightTool } from "../types";
import { isSolvedGrid, sudokuPuzzle } from "./logic";
import styles from "./SudokuBoard.module.css";
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
  SUDOKU_NUMBER_PAD_COLUMNS,
  SUDOKU_ROW_LABELS,
  sudokuCandidateDigits,
  sudokuCellHighlightCount,
  sudokuHighlightRegions,
  toggleSudokuCellHighlightRegion,
  toSudokuMirrorState,
  type SudokuBoardState,
  type SudokuEntryMode,
} from "./state";

const ENTRY_MODES: SudokuEntryMode[] = ["candidate", "value"];
const INVALID_CELL_VISIBLE_MS = 1_100;
const INVALID_MESSAGE_DELAY_MS = 440;
const INVALID_MESSAGE_VISIBLE_MS = 2_600;
const MAX_HIGHLIGHT_UNDO_STEPS = 50;
const ANSWER_REVEAL_ANIMATION_MS = 320;
const HIGHLIGHT_TOOL_DEFS = [
  { tool: "cell", label: "highlightCells", Icon: Scan },
  { tool: "box", label: "highlightBox", Icon: SquareDashed },
  { tool: "row", label: "highlightRow", Icon: Rows3 },
  { tool: "column", label: "highlightColumn", Icon: Columns3 },
  { tool: "digit", label: "highlightDigit", Icon: Hash },
] as const satisfies ReadonlyArray<{
  tool: SudokuHighlightTool;
  label: "highlightCells" | "highlightBox" | "highlightRow" | "highlightColumn" | "highlightDigit";
  Icon: typeof SquareDashed;
}>;

interface SudokuDragSelection {
  pointerId: number;
  startIndex: number;
  endIndex: number;
}

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
  const [dragSelection, setDragSelection] = useState<SudokuDragSelection | null>(null);
  const [highlightUndoStack, setHighlightUndoStack] = useState<SudokuBoardState["highlights"][]>([]);
  const [revealedCell, setRevealedCell] = useState<number | null>(null);
  const seenInvalidAttempt = useRef(invalidAttemptKey);
  const boardGridRef = useRef<HTMLDivElement>(null);
  const dragSelectionRef = useRef<SudokuDragSelection | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragEndRef = useRef<number | null>(null);
  const answerRevealTimerRef = useRef<number | null>(null);
  const suppressCellClick = useRef(false);
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

  useEffect(() => () => {
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    if (answerRevealTimerRef.current !== null) window.clearTimeout(answerRevealTimerRef.current);
  }, []);

  // 课堂镜像：新状态对象到达即在渲染期对齐本地（React「adjust state during render」模式）。
  if (puzzleKey !== appliedPuzzleKey) {
    setAppliedPuzzleKey(puzzleKey);
    setAppliedMirror(mirror);
    setState(createSudokuBoardState(puzzle, mirror));
    setHighlightUndoStack([]);
    setRevealedCell(null);
  } else if (mirror !== appliedMirror) {
    setAppliedMirror(mirror);
    if (mirror) setState(createSudokuBoardState(puzzle, mirror));
  }

  const inputDisabled = Boolean(readOnly || finished);
  const digitHighlightMode = state.highlightTool === "digit";
  const numberPadDisabled = inputDisabled || Boolean(state.highlightTool && !digitHighlightMode);
  const deleteDisabled = inputDisabled || Boolean(state.highlightTool);
  const answerDisabled = inputDisabled
    || state.highlightTool !== null
    || state.selected === null
    || Boolean(puzzle[state.selected])
    || Boolean(state.values[state.selected]);
  const highlightRegions = sudokuHighlightRegions(state.highlights);
  const dragRegion = dragSelection
    ? createSudokuCellHighlightRegion(dragSelection.startIndex, dragSelection.endIndex)
    : null;
  const hasStructuralHighlights = highlightRegions.length > 0 || Boolean(dragRegion);

  function commit(next: SudokuBoardState, trackHighlightChange = true) {
    if (next === state) return;
    if (trackHighlightChange && next.highlights !== state.highlights) {
      setHighlightUndoStack((history) => [
        ...history.slice(-(MAX_HIGHLIGHT_UNDO_STEPS - 1)),
        state.highlights,
      ]);
    }
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

  function updateDragSelection(next: SudokuDragSelection | null) {
    dragSelectionRef.current = next;
    setDragSelection(next);
  }

  function cellIndexFromPoint(clientX: number, clientY: number): number | null {
    const board = boardGridRef.current;
    if (!board) return null;
    const bounds = board.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const column = Math.min(8, Math.max(0, Math.floor(((clientX - bounds.left) / bounds.width) * 9)));
    const row = Math.min(8, Math.max(0, Math.floor(((clientY - bounds.top) / bounds.height) * 9)));
    return row * 9 + column;
  }

  function beginCellHighlight(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (inputDisabled || state.highlightTool !== "cell") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    suppressCellClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateDragSelection({ pointerId: event.pointerId, startIndex: index, endIndex: index });
  }

  function moveCellHighlight(event: PointerEvent<HTMLDivElement>) {
    const active = dragSelectionRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const endIndex = cellIndexFromPoint(event.clientX, event.clientY);
    if (endIndex === null || endIndex === active.endIndex) return;
    pendingDragEndRef.current = endIndex;
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const current = dragSelectionRef.current;
      const pendingEnd = pendingDragEndRef.current;
      pendingDragEndRef.current = null;
      if (!current || pendingEnd === null || current.endIndex === pendingEnd) return;
      updateDragSelection({ ...current, endIndex: pendingEnd });
    });
  }

  function cancelQueuedDragUpdate() {
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null;
    pendingDragEndRef.current = null;
  }

  function finishCellHighlight(event: PointerEvent<HTMLDivElement>) {
    const active = dragSelectionRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const endIndex = cellIndexFromPoint(event.clientX, event.clientY) ?? active.endIndex;
    cancelQueuedDragUpdate();
    suppressCellClick.current = true;
    updateDragSelection(null);
    commit(toggleSudokuCellHighlightRegion(state, active.startIndex, endIndex));
    window.setTimeout(() => {
      suppressCellClick.current = false;
    }, 0);
  }

  function cancelCellHighlight(event: PointerEvent<HTMLDivElement>) {
    const active = dragSelectionRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    cancelQueuedDragUpdate();
    suppressCellClick.current = false;
    updateDragSelection(null);
  }

  function clickCell(index: number) {
    if (state.highlightTool === "cell" && suppressCellClick.current) {
      suppressCellClick.current = false;
      return;
    }
    selectCell(index);
  }

  function deleteEntry() {
    if (deleteDisabled) return;
    commit(deleteSelectedSudokuCell(state, puzzle));
  }

  function undoTeachingHighlight() {
    const previousHighlights = highlightUndoStack.at(-1);
    if (!previousHighlights) return;
    setHighlightUndoStack((history) => history.slice(0, -1));
    commit({ ...state, highlights: previousHighlights }, false);
  }

  function revealSelectedAnswer() {
    const selected = state.selected;
    const next = revealSelectedSudokuCell(state, puzzle);
    if (selected === null || next === state) return;
    if (answerRevealTimerRef.current !== null) window.clearTimeout(answerRevealTimerRef.current);
    setRevealedCell(selected);
    answerRevealTimerRef.current = window.setTimeout(() => {
      answerRevealTimerRef.current = null;
      setRevealedCell(null);
    }, ANSWER_REVEAL_ANIMATION_MS);
    commit(next);
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
      <div className="mx-auto grid h-full min-h-96 min-w-[38rem] max-w-5xl grid-cols-[7.25rem_minmax(0,1fr)_3.375rem] items-center gap-4 p-1 sm:gap-6">
        <aside className="w-full max-w-[7.25rem] justify-self-center">
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
                  data-classroom-input="click"
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
                          data-classroom-input="click"
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
                        data-classroom-input="click"
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
            <div
              ref={boardGridRef}
              className={cn(
                styles.boardGrid,
                state.highlightTool === "cell" && styles.regionDragActive,
                "grid grid-cols-9 overflow-hidden rounded-xl border-2",
              )}
              data-has-structural-highlights={hasStructuralHighlights || undefined}
              onPointerCancel={cancelCellHighlight}
              onPointerMove={moveCellHighlight}
              onPointerUp={finishCellHighlight}
            >
              {state.values.map((value, index) => {
                const given = puzzle[index] !== 0;
                const column = index % 9;
                const row = Math.floor(index / 9);
                const box = Math.floor(row / 3) * 3 + Math.floor(column / 3);
                const coordinate = `${SUDOKU_ROW_LABELS[row]}${SUDOKU_COLUMN_LABELS[column]}`;
                const candidateDigits = sudokuCandidateDigits(state.candidates[index]);
                const structuralHighlightCount = sudokuCellHighlightCount(state.highlights, row, column);
                const inDragRegion = Boolean(
                  dragRegion
                  && row >= dragRegion.top
                  && row <= dragRegion.bottom
                  && column >= dragRegion.left
                  && column <= dragRegion.right,
                );
                const structurallyHighlighted = structuralHighlightCount > 0 || inDragRegion;
                const digitHighlighted = Boolean(value && state.highlights.focusedDigit === value);
                const teachingHighlighted = structurallyHighlighted || digitHighlighted;
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
                    data-classroom-input={state.highlightTool === "cell" ? "drag" : "click"}
                    aria-label={label}
                    aria-pressed={state.selected === index}
                    disabled={inputDisabled}
                    data-box={box + 1}
                    data-answer-revealed={revealedCell === index || undefined}
                    data-column={column + 1}
                    data-coordinate={coordinate}
                    data-digit={value || undefined}
                    data-given={given || undefined}
                    data-highlight-count={structuralHighlightCount + Number(inDragRegion) || undefined}
                    data-invalid-attempt={invalid || undefined}
                    data-highlight-dimmed={(hasStructuralHighlights && !structurallyHighlighted) || undefined}
                    data-row={SUDOKU_ROW_LABELS[row]}
                    data-teaching-highlight={teachingHighlighted || undefined}
                    onClick={() => clickCell(index)}
                    onPointerDown={(event) => beginCellHighlight(event, index)}
                    className={cn(
                      styles.cell,
                      "relative flex aspect-square items-center justify-center tabular-nums outline-none transition-[background-color,box-shadow] duration-100 disabled:cursor-default disabled:opacity-100",
                      greenBox ? styles.greenCell : styles.blueCell,
                      column < 8 && (column % 3 === 2 ? styles.majorRight : styles.minorRight),
                      row < 8 && (row % 3 === 2 ? styles.majorBottom : styles.minorBottom),
                      hasStructuralHighlights && !structurallyHighlighted && styles.dimmedCell,
                      !inputDisabled && !state.highlightTool && "hover:brightness-[0.97]",
                      state.highlightTool && !inputDisabled && "cursor-crosshair",
                      state.selected === index && state.highlightTool === null && styles.selectedCell,
                      invalid && styles.invalidCell,
                    )}
                  >
                    {value ? (
                      <span
                        className={cn(
                          "text-[clamp(1rem,3vw,2rem)] leading-none",
                          given ? cn(styles.givenTile, "font-medium") : cn(styles.filledDigit, "font-medium"),
                          digitHighlighted && styles.digitHighlight,
                          revealedCell === index && styles.revealedDigit,
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
              <div aria-hidden className={styles.highlightLayer}>
                {highlightRegions.map((region) => (
                  <span
                    key={region.key}
                    className={styles.highlightRegion}
                    data-highlight-region={region.kind}
                    data-highlight-target={region.target}
                    style={{
                      gridColumn: `${region.columnStart} / span ${region.columnSpan}`,
                      gridRow: `${region.rowStart} / span ${region.rowSpan}`,
                    }}
                  />
                ))}
                {dragRegion ? (
                  <span
                    className={cn(styles.highlightRegion, styles.highlightPreview)}
                    data-highlight-preview
                    style={{
                      gridColumn: `${dragRegion.left + 1} / span ${dragRegion.right - dragRegion.left + 1}`,
                      gridRow: `${dragRegion.top + 1} / span ${dragRegion.bottom - dragRegion.top + 1}`,
                    }}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div
          aria-label={t("highlightToolbar")}
          className={cn(styles.toolBar, "flex flex-col items-center gap-1 rounded-xl border p-1 justify-self-center")}
          role="toolbar"
        >
          {HIGHLIGHT_TOOL_DEFS.map(({ tool, label, Icon }) => (
            <button
              key={tool}
              type="button"
              data-classroom-input="click"
              aria-label={t(label)}
              aria-pressed={state.highlightTool === tool}
              title={t(label)}
              disabled={inputDisabled}
              onClick={() => commit(setSudokuHighlightTool(state, tool))}
              className={cn(
                styles.toolButton,
                "grid size-10 shrink-0 place-items-center rounded-lg border transition-colors disabled:cursor-default disabled:opacity-100",
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
            data-classroom-input="click"
            aria-label={t("undoHighlight")}
            title={t("undoHighlight")}
            disabled={inputDisabled || highlightUndoStack.length === 0}
            onClick={undoTeachingHighlight}
            className={cn(
              styles.toolButton,
              styles.controlIdle,
              "grid size-10 shrink-0 place-items-center rounded-lg border transition-colors disabled:cursor-default disabled:opacity-35",
            )}
          >
            <Undo2 aria-hidden size={18} />
          </button>
          <button
            type="button"
            data-classroom-input="click"
            aria-label={t("clearHighlights")}
            title={t("clearHighlights")}
            disabled={inputDisabled || !hasSudokuTeachingHighlights(state)}
            onClick={() => commit(clearSudokuTeachingHighlights(state))}
            className={cn(
              styles.toolButton,
              styles.controlIdle,
              "grid size-10 shrink-0 place-items-center rounded-lg border transition-colors disabled:cursor-default disabled:opacity-35",
            )}
          >
            <Trash2 aria-hidden size={18} />
          </button>
          <span aria-hidden className={cn(styles.toolSeparator, "h-px w-7")} />
          <button
            type="button"
            data-classroom-input="click"
            aria-label={t("revealSelectedAnswer")}
            title={t("revealSelectedAnswer")}
            disabled={answerDisabled}
            onClick={revealSelectedAnswer}
            className={cn(
              styles.toolButton,
              styles.answerButton,
              styles.controlIdle,
              "grid size-10 shrink-0 place-items-center rounded-lg border transition-colors disabled:cursor-default disabled:opacity-35",
            )}
          >
            <Eye aria-hidden size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
