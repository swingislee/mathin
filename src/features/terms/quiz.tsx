"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { QuizItem } from "@/lib/content";

/** 「试一试」：轻量前端自测，选错可再选（docs/plan/02-3.3） */
export function Quiz({ items, correctLabel, wrongLabel }: { items: QuizItem[]; correctLabel: string; wrongLabel: string }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  return (
    <ol className="mt-4 space-y-6">
      {items.map((item, qi) => {
        const sel = picked[qi];
        const answered = sel !== undefined;
        const correct = answered && sel === item.answer;
        return (
          <li key={qi}>
            <p className="leading-7">
              <span className="mr-2 font-serif text-sm text-[var(--p-accent,var(--crater))]">{qi + 1}.</span>
              {item.q}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {item.options.map((opt, oi) => {
                const isSel = sel === oi;
                const isRight = isSel && oi === item.answer;
                const isWrong = isSel && oi !== item.answer;
                return (
                  <button
                    key={oi}
                    type="button"
                    onClick={() => setPicked((p) => ({ ...p, [qi]: oi }))}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-200",
                      !isSel && "border-line bg-card hover:bg-moon/40",
                      isRight && "border-leaf-deep bg-leaf/30 text-leaf-deep",
                      isWrong && "border-rose bg-cheek/30 text-rose-deep",
                    )}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {answered && (
              <p className={cn("mt-2 text-sm", correct ? "text-leaf-deep" : "text-rose-deep")}>
                {correct ? `✓ ${correctLabel}` : wrongLabel}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
