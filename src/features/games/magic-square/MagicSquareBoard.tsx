"use client";

import { Eraser } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { GameBoardProps } from "../types";
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

export function MagicSquareBoard({ seed, difficulty, finished, onComplete }: GameBoardProps) {
  const t = useTranslations("games.magicSquare");
  const puzzle = useMemo(() => magicPuzzle(seed, difficulty), [seed, difficulty]);
  const [values, setValues] = useState<number[]>(() => [...puzzle.givens]);
  const [selected, setSelected] = useState<number | null>(null);
  const badCells = useMemo(() => findBadCells(puzzle.n, puzzle.magicSum, values), [puzzle, values]);
  const used = useMemo(() => new Set(values.filter((v) => v > 0)), [values]);

  function put(n: number) {
    if (finished || selected === null || puzzle.givens[selected] !== 0) return;
    if (n !== 0 && used.has(n) && values[selected] !== n) return;
    const next = [...values];
    next[selected] = n;
    setValues(next);
    if (n && isMagicSolved(puzzle.n, next)) onComplete(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") return put(0);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -puzzle.n, ArrowDown: puzzle.n }[e.key];
    if (step && selected !== null) {
      e.preventDefault();
      const next = selected + step;
      if (next >= 0 && next < puzzle.n * puzzle.n) setSelected(next);
    }
  }

  return (
    <div className="mx-auto max-w-sm outline-none" tabIndex={0} onKeyDown={onKeyDown}>
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
              onClick={() => setSelected(i)}
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
          aria-label="erase"
          className="flex h-9 items-center justify-center rounded-lg border bg-card transition duration-150 hover:bg-(--p-wash) disabled:opacity-50"
        >
          <Eraser size={16} />
        </button>
      </div>
    </div>
  );
}
