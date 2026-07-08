"use client";

import { Eraser } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { GameBoardProps, GameMirrorState } from "../types";
import { isKakuroSolved, kakuroPuzzle, type KakuroPuzzle } from "./logic";

/** 出错段（重复数字 / 和超出 / 填满但和不符）里的白格 */
function findBadCells(puzzle: KakuroPuzzle, values: number[]): Set<number> {
  const bad = new Set<number>();
  for (const run of puzzle.runs) {
    const digits = run.cells.map((c) => values[c]).filter((v) => v > 0);
    const full = digits.length === run.cells.length;
    const sum = digits.reduce((a, b) => a + b, 0);
    const broken = new Set(digits).size !== digits.length || sum > run.sum || (full && sum !== run.sum);
    if (broken) for (const c of run.cells) if (values[c] > 0) bad.add(c);
  }
  return bad;
}

export function KakuroBoard({ seed, difficulty, finished, onComplete, mirror, onMirror, readOnly }: GameBoardProps) {
  const puzzle = useMemo(() => kakuroPuzzle(seed, difficulty), [seed, difficulty]);
  const [values, setValues] = useState<number[]>(() => new Array(puzzle.black.length).fill(0));
  const [selected, setSelected] = useState<number | null>(null);

  // 课堂镜像：新状态对象到达即在渲染期对齐本地（React「adjust state during render」模式）
  const [appliedMirror, setAppliedMirror] = useState<GameMirrorState | null | undefined>(mirror);
  if (mirror !== appliedMirror) {
    setAppliedMirror(mirror);
    if (mirror && Array.isArray(mirror.values) && mirror.values.length === puzzle.black.length) {
      setValues([...mirror.values]);
      setSelected(typeof mirror.selected === "number" ? mirror.selected : null);
    }
  }
  const badCells = useMemo(() => findBadCells(puzzle, values), [puzzle, values]);
  const clues = useMemo(() => {
    const map = new Map<number, { h?: number; v?: number }>();
    for (const run of puzzle.runs) {
      const entry = map.get(run.clueAt) ?? {};
      entry[run.dir] = run.sum;
      map.set(run.clueAt, entry);
    }
    return map;
  }, [puzzle]);

  function select(i: number) {
    if (readOnly) return;
    setSelected(i);
    onMirror?.({ values, selected: i });
  }

  function put(n: number) {
    if (readOnly || finished || selected === null || puzzle.black[selected]) return;
    const next = [...values];
    next[selected] = n;
    setValues(next);
    onMirror?.({ values: next, selected });
    if (n && isKakuroSolved(puzzle, next)) onComplete(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key >= "1" && e.key <= "9") return put(Number(e.key));
    if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") return put(0);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -puzzle.cols, ArrowDown: puzzle.cols }[e.key];
    if (step && selected !== null) {
      e.preventDefault();
      const next = selected + step;
      if (next >= 0 && next < puzzle.black.length) select(next);
    }
  }

  return (
    <div className="mx-auto max-w-md outline-none" tabIndex={0} onKeyDown={onKeyDown}>
      <div
        className="grid overflow-hidden rounded-lg border-2 border-ink/50"
        style={{ gridTemplateColumns: `repeat(${puzzle.cols}, minmax(0, 1fr))` }}
      >
        {values.map((v, i) => {
          if (puzzle.black[i]) {
            const clue = clues.get(i);
            return (
              <div key={i} className="relative aspect-square border border-line/40 bg-ink/80 text-[10px] leading-none text-paper sm:text-xs">
                {clue?.h !== undefined && <span className="absolute right-1 top-1 tabular-nums">{clue.h}</span>}
                {clue?.v !== undefined && <span className="absolute bottom-1 left-1 tabular-nums">{clue.v}</span>}
              </div>
            );
          }
          return (
            <button
              key={i}
              onClick={() => select(i)}
              className={cn(
                "flex aspect-square items-center justify-center border border-line bg-card text-lg tabular-nums transition-colors duration-100 sm:text-xl",
                "text-(--p-accent)",
                badCells.has(i) && "text-rose",
                selected === i && "bg-(--p-wash)",
              )}
            >
              {v || ""}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button
            key={n}
            onClick={() => put(n)}
            disabled={finished}
            className="flex size-9 items-center justify-center rounded-lg border bg-card text-base tabular-nums transition duration-150 hover:bg-(--p-wash) disabled:opacity-50"
          >
            {n}
          </button>
        ))}
        <button
          onClick={() => put(0)}
          disabled={finished}
          aria-label="erase"
          className="flex size-9 items-center justify-center rounded-lg border bg-card transition duration-150 hover:bg-(--p-wash) disabled:opacity-50"
        >
          <Eraser size={16} />
        </button>
      </div>
    </div>
  );
}
