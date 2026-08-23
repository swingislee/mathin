"use client";

import { Eraser } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { GameBoardProps, GameMirrorState } from "../types";
import { isSolvedGrid, sudokuPuzzle } from "./logic";
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
  type SudokuBoardState,
  type SudokuEntryMode,
} from "./state";

const ENTRY_MODES: SudokuEntryMode[] = ["candidate", "value"];

export function SudokuBoard({ seed, difficulty, finished, onComplete, mirror, onMirror, readOnly }: GameBoardProps) {
  const t = useTranslations("games.sudokuBoard");
  const puzzleKey = `${seed}:${difficulty}`;
  const puzzle = useMemo(() => sudokuPuzzle(seed, difficulty), [seed, difficulty]);
  const [state, setState] = useState<SudokuBoardState>(() => createSudokuBoardState(puzzle, mirror));
  const [appliedMirror, setAppliedMirror] = useState<GameMirrorState | null | undefined>(mirror);
  const [appliedPuzzleKey, setAppliedPuzzleKey] = useState(puzzleKey);

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
    if (inputDisabled) return;
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
      className="mx-auto h-full w-full overflow-auto rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-crater focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      tabIndex={inputDisabled ? -1 : 0}
      onKeyDown={onKeyDown}
    >
      <div className="mx-auto grid h-full min-h-96 min-w-[34rem] max-w-4xl grid-cols-[minmax(6.75rem,8.5rem)_minmax(0,1fr)] items-center gap-4 p-1 sm:gap-6">
        <aside className="flex w-full max-w-[8.5rem] flex-col gap-3 justify-self-center">
          <div
            aria-label={t("entryMode")}
            className="grid grid-cols-2 rounded-xl border border-line bg-card p-1"
            role="radiogroup"
          >
            {ENTRY_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={state.entryMode === mode}
                disabled={inputDisabled}
                onClick={() => commit(setSudokuEntryMode(state, mode))}
                className={cn(
                  "min-h-10 rounded-lg px-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-crater disabled:cursor-default disabled:opacity-100",
                  state.entryMode === mode ? "bg-ink text-paper" : "text-muted hover:bg-moon/30 hover:text-ink",
                )}
              >
                {t(mode === "candidate" ? "candidateMode" : "valueMode")}
              </button>
            ))}
          </div>

          <div aria-label={t("numberPad")} className="grid grid-cols-2 gap-2" role="group">
            {SUDOKU_NUMBER_PAD_COLUMNS.map((column, columnIndex) => (
              <div key={columnIndex} className="flex flex-col gap-2">
                {column.map((digit) =>
                  digit === null ? (
                    <button
                      key="delete"
                      type="button"
                      aria-label={t("deleteEntry")}
                      title={t("deleteEntry")}
                      disabled={inputDisabled}
                      onClick={deleteEntry}
                      className="grid aspect-square min-h-11 w-full place-items-center rounded-xl border border-line bg-card text-muted outline-none transition-colors hover:border-ink/40 hover:bg-moon/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-crater disabled:cursor-default disabled:opacity-100"
                    >
                      <Eraser aria-hidden size={20} />
                    </button>
                  ) : (
                    <button
                      key={digit}
                      type="button"
                      aria-label={t("chooseDigit", { digit })}
                      aria-pressed={state.inputDigit === digit}
                      disabled={inputDisabled}
                      onClick={() => chooseDigit(digit)}
                      className={cn(
                        "aspect-square min-h-11 w-full rounded-xl border text-xl font-medium tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-crater disabled:cursor-default disabled:opacity-100",
                        state.inputDigit === digit
                          ? "border-ink bg-ink text-paper"
                          : "border-line bg-card text-ink hover:border-ink/40 hover:bg-moon/30",
                      )}
                    >
                      {digit}
                    </button>
                  ),
                )}
              </div>
            ))}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 items-center justify-center self-stretch">
          <div className="grid aspect-square h-auto max-h-full w-full max-w-[42rem] grid-cols-[clamp(1rem,3vw,1.65rem)_minmax(0,1fr)] grid-rows-[clamp(1rem,3vw,1.65rem)_minmax(0,1fr)]">
            <span aria-hidden />
            <div aria-hidden className="grid grid-cols-9 text-xs font-medium text-muted sm:text-sm">
              {SUDOKU_COLUMN_LABELS.map((label) => (
                <span key={label} className="grid place-items-center tabular-nums">{label}</span>
              ))}
            </div>
            <div aria-hidden className="grid grid-rows-9 text-xs font-medium text-muted sm:text-sm">
              {SUDOKU_ROW_LABELS.map((label) => (
                <span key={label} className="grid place-items-center">{label}</span>
              ))}
            </div>
            <div className="grid grid-cols-9 overflow-hidden rounded-xl border-2 border-ink/55 bg-card shadow-sm">
              {state.values.map((value, index) => {
                const given = puzzle[index] !== 0;
                const column = index % 9;
                const row = Math.floor(index / 9);
                const box = Math.floor(row / 3) * 3 + Math.floor(column / 3);
                const coordinate = `${SUDOKU_ROW_LABELS[row]}${SUDOKU_COLUMN_LABELS[column]}`;
                const candidateDigits = sudokuCandidateDigits(state.candidates[index]);
                const label = given
                  ? t("givenCell", { coordinate, value })
                  : value
                    ? t("filledCell", { coordinate, value })
                    : candidateDigits.length
                      ? t("candidateCell", { coordinate, values: candidateDigits.join(" ") })
                      : t("emptyCell", { coordinate });
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
                    data-row={SUDOKU_ROW_LABELS[row]}
                    onClick={() => selectCell(index)}
                    className={cn(
                      "relative flex aspect-square items-center justify-center tabular-nums outline-none transition-[background-color,filter,box-shadow] duration-100 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-crater disabled:cursor-default disabled:opacity-100",
                      greenBox ? "bg-leaf/20" : "bg-blue/10",
                      column < 8 && (column % 3 === 2 ? "border-r-2 border-r-ink/65" : "border-r border-r-line"),
                      row < 8 && (row % 3 === 2 ? "border-b-2 border-b-ink/65" : "border-b border-b-line"),
                      !inputDisabled && "hover:brightness-[0.97]",
                      state.selected === index && "z-10 bg-moon/65 ring-2 ring-inset ring-crater",
                    )}
                  >
                    {value ? (
                      <span className={cn("text-[clamp(1rem,3vw,2rem)] leading-none", given ? "font-semibold text-ink" : "font-medium text-blue")}>{value}</span>
                    ) : candidateDigits.length ? (
                      <span aria-hidden className="grid size-full grid-cols-3 grid-rows-3 p-[5%] text-[clamp(0.48rem,1.2vw,0.72rem)] leading-none text-blue">
                        {Array.from({ length: 9 }, (_, candidateIndex) => candidateIndex + 1).map((digit) => (
                          <span key={digit} className="grid place-items-center">{candidateDigits.includes(digit) ? digit : ""}</span>
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
