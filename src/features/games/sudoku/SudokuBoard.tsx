"use client";

import { Eraser } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { GameBoardProps, GameMirrorState } from "../types";
import { isSolvedGrid, sudokuPuzzle } from "./logic";

/** 有冲突（行/列/宫重复）的格子下标集合，只做轻提示 */
function findConflicts(values: number[]): Set<number> {
  const bad = new Set<number>();
  for (let i = 0; i < 81; i++) {
    const v = values[i];
    if (!v) continue;
    const row = Math.floor(i / 9);
    const col = i % 9;
    const b = Math.floor(row / 3) * 27 + Math.floor(col / 3) * 3;
    for (let k = 0; k < 9; k++) {
      const peers = [row * 9 + k, k * 9 + col, b + Math.floor(k / 3) * 9 + (k % 3)];
      for (const p of peers) {
        if (p !== i && values[p] === v) {
          bad.add(i);
          bad.add(p);
        }
      }
    }
  }
  return bad;
}

export function SudokuBoard({ seed, difficulty, finished, onComplete, mirror, onMirror, readOnly }: GameBoardProps) {
  const t = useTranslations("games");
  const puzzle = useMemo(() => sudokuPuzzle(seed, difficulty), [seed, difficulty]);
  const [values, setValues] = useState<number[]>(() => [...puzzle]);
  const [selected, setSelected] = useState<number | null>(null);
  const conflicts = useMemo(() => findConflicts(values), [values]);

  // 课堂镜像：新状态对象到达即在渲染期对齐本地（React「adjust state during render」模式）
  const [appliedMirror, setAppliedMirror] = useState<GameMirrorState | null | undefined>(mirror);
  if (mirror !== appliedMirror) {
    setAppliedMirror(mirror);
    if (mirror && Array.isArray(mirror.values) && mirror.values.length === puzzle.length) {
      setValues([...mirror.values]);
      setSelected(typeof mirror.selected === "number" ? mirror.selected : null);
    }
  }

  function select(i: number) {
    if (readOnly) return;
    setSelected(i);
    onMirror?.({ values, selected: i });
  }

  function put(n: number) {
    if (readOnly || finished || selected === null || puzzle[selected] !== 0) return;
    const next = [...values];
    next[selected] = n;
    setValues(next);
    onMirror?.({ values: next, selected });
    if (n && next.every((v) => v > 0) && isSolvedGrid(next)) onComplete(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key >= "1" && e.key <= "9") return put(Number(e.key));
    if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") return put(0);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 }[e.key];
    if (step && selected !== null) {
      e.preventDefault();
      const next = selected + step;
      if (next >= 0 && next < 81) select(next);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-crater focus-visible:ring-offset-2 focus-visible:ring-offset-paper" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="grid grid-cols-9 overflow-hidden rounded-lg border-2 border-ink/50 bg-card">
        {values.map((v, i) => {
          const given = puzzle[i] !== 0;
          const col = i % 9;
          const row = Math.floor(i / 9);
          return (
            <button
              key={i}
              aria-label={`r${row + 1}c${col + 1}`}
              onClick={() => select(i)}
              className={cn(
                "flex aspect-square items-center justify-center text-lg tabular-nums transition-colors duration-100 sm:text-xl",
                // 单边颜色类会被 border-line（shorthand）覆盖，因此四边颜色全部用单边类
                col < 8 && (col % 3 === 2 ? "border-r-2 border-r-ink/70" : "border-r border-r-line"),
                row < 8 && (row % 3 === 2 ? "border-b-2 border-b-ink/70" : "border-b border-b-line"),
                given ? "font-semibold" : "text-(--p-accent)",
                conflicts.has(i) && "text-rose",
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
          aria-label={t("erase")}
          className="flex size-9 items-center justify-center rounded-lg border bg-card transition duration-150 hover:bg-(--p-wash) disabled:opacity-50"
        >
          <Eraser size={16} />
        </button>
      </div>
    </div>
  );
}
