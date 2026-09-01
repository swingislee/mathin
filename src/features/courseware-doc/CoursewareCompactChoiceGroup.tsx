"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CoursewareCompactChoice<T extends string> {
  value: T;
  label: string;
  icon: ReactNode;
  meta: ReactNode;
  disabled?: boolean;
}

/**
 * Shared compact selector for dense courseware inspector choices.
 * The full label remains available to screen readers and pointer tooltips;
 * the visible control only carries an icon and its short numeric identity.
 */
export function CoursewareCompactChoiceGroup<T extends string>({
  value,
  choices,
  ariaLabel,
  onValueChange,
  className,
}: {
  value: T;
  choices: CoursewareCompactChoice<T>[];
  ariaLabel: string;
  onValueChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("grid gap-1", className)}
      style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}
    >
      {choices.map((choice) => {
        const selected = value === choice.value;
        return (
          <Button
            key={choice.value}
            type="button"
            size="sm"
            variant="ghost"
            title={choice.label}
            aria-label={choice.label}
            aria-pressed={selected}
            disabled={choice.disabled}
            className={cn(
              "h-14 min-w-0 flex-col gap-0.5 rounded-lg border border-transparent px-1 py-1 text-muted",
              selected && "border-crater bg-moon/35 text-ink",
            )}
            onClick={() => onValueChange(choice.value)}
          >
            <span aria-hidden="true" className="grid h-6 place-items-center">{choice.icon}</span>
            <span aria-hidden="true" className="max-w-full truncate text-[11px] tabular-nums leading-none">{choice.meta}</span>
          </Button>
        );
      })}
    </div>
  );
}
