"use client";

import { Eraser } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { GameBoardProps, GameMirrorState } from "../types";
import { isMagicSolved, magicPuzzle } from "./logic";

/** 已填满但和不等于幻和的行/列/对角线里的格子 */
function findBadCells(n: number, target: number, values: number[]): Set<number> {
  const bad = new Set<number>();
  const lines: number[][] = [];
  for (let i = 0; i < n; i++) {
    lines.push(Array.from({ length: n }, (_, j) => i * n + j));
    lines.push(Array.from({ length: n }, (_, j) => j * n + i));
  }
  lines.push(Array.from({ length: n }, (_, i) => i * n + i));
  lines.push(Array.from({ length: n }, (_, i) => i * n + (n - 1 - i)));
  for (const line of lines) {
    const digits = line.map((c) => values[c]);
    if (digits.every((v) => v > 0) && digits.reduce((a, b) => a + b, 0) !== target) {
      for (const c of line) bad.add(c);
    }
  }
  return bad;
}

export function MagicSquareBoard({ seed, difficulty, finished, onComplete, mirror, onMirror, readOnly }: GameBoardProps) {
  const t = useTranslations("games.magicSquare");
  const tGames = useTranslations("games");
  const puzzle = useMemo(() => magicPuzzle(seed, difficulty), [seed, difficulty]);
  const [values, setValues] = useState<number[]>(() => [...puzzle.givens]);
  const [selected, setSelected] = useState<number | null>(null);
  const badCells = useMemo(() => findBadCells(puzzle.n, puzzle.magicSum, values), [puzzle, values]);
  const used = useMemo(() => new Set(values.filter((v) => v > 0)), [values]);

  // 课堂镜像：新状态对象到达即在渲染期对齐本地（React「adjust state during render」模式）
  const [appliedMirror, setAppliedMirror] = useState<GameMirrorState | null | undefined>(mirror);
  if (mirror !== appliedMirror) {
    setAppliedMirror(mirror);
    if (mirror && Array.isArray(mirror.values) && mirror.values.length === puzzle.givens.length) {
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
    if (readOnly || finished || selected === null || puzzle.givens[selected] !== 0) return;
    if (n !== 0 && used.has(n) && values[selected] !== n) return;
    const next = [...values];
    next[selected] = n;
    setValues(next);
    onMirror?.({ values: next, selected });
    if (n && isMagicSolved(puzzle.n, next)) onComplete(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") return put(0);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -puzzle.n, ArrowDown: puzzle.n }[e.key];
    if (step && selected !== null) {
      e.preventDefault();
      const next = selected + step;
      if (next >= 0 && next < puzzle.n * puzzle.n) select(next);
    }
  }

  return (
    <div className="mx-auto max-w-sm rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-crater focus-visible:ring-offset-2 focus-visible:ring-offset-paper" tabIndex={0} onKeyDown={onKeyDown}>
      <p className="mb-4 text-center text-sm text-muted">{t("target", { sum: puzzle.magicSum })}</p>
      <div
        className="grid overflow-hidden rounded-lg border-2 border-ink/50 bg-card"
        style={{ gridTemplateColumns: `repeat(${puzzle.n}, minmax(0, 1fr))` }}
      >
        {values.map((v, i) => {
          const given = puzzle.givens[i] !== 0;
          return (
            <button
              key={i}
              onClick={() => select(i)}
              className={cn(
                "flex aspect-square items-center justify-center border border-line text-xl tabular-nums transition-colors duration-100 sm:text-2xl",
                given ? "font-semibold" : "text-(--p-accent)",
                badCells.has(i) && "text-rose",
                selected === i && "bg-(--p-wash)",
              )}
            >
              {v || ""}
            </button>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-8 justify-center gap-1.5">
        {Array.from({ length: puzzle.n * puzzle.n }, (_, k) => k + 1).map((n) => (
          <button
            key={n}
            onClick={() => put(n)}
            disabled={finished || (used.has(n) && (selected === null || values[selected] !== n))}
            className="flex h-9 items-center justify-center rounded-lg border bg-card text-sm tabular-nums transition duration-150 hover:bg-(--p-wash) disabled:opacity-40"
          >
            {n}
          </button>
        ))}
        <button
          onClick={() => put(0)}
          disabled={finished}
          aria-label={tGames("erase")}
          className="flex h-9 items-center justify-center rounded-lg border bg-card transition duration-150 hover:bg-(--p-wash) disabled:opacity-50"
        >
          <Eraser size={16} />
        </button>
      </div>
    </div>
  );
}
