"use client";

import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { LearningCheckStatusIcon } from "./LearningCheckStatusIcon";
import {
  LEARNING_SEAT_CAPACITY,
  LEARNING_SEAT_COLUMNS,
  type LearningCheckStatus,
} from "./session-learning-contract";
import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";

export interface LearningCheckQuickChoice<Value extends string> {
  value: Value;
  label: string;
  visualStatus: LearningCheckStatus;
  shortcut?: string;
}

interface LearningCheckQuickEntryGridProps extends HTMLAttributes<HTMLDivElement> {
  itemCount: number;
}

/**
 * The classroom learning-check 4 × 5 surface. Consumers provide the axis
 * objects (students or questions); this component owns the already-tuned grid
 * density and the 21+ item overflow behavior.
 */
export const LearningCheckQuickEntryGrid = forwardRef<HTMLDivElement, LearningCheckQuickEntryGridProps>(
  function LearningCheckQuickEntryGrid({ itemCount, className, style, children, ...props }, ref) {
    return (
      <div
        {...props}
        ref={ref}
        className={cn(
          "grid min-h-0 min-w-0 flex-1 gap-0.5",
          itemCount > LEARNING_SEAT_CAPACITY
            ? "auto-rows-[minmax(7.75rem,1fr)] overflow-y-auto pr-1"
            : "auto-rows-[minmax(0,1fr)] overflow-y-hidden",
          className,
        )}
        style={{
          gridTemplateColumns: `repeat(${LEARNING_SEAT_COLUMNS}, minmax(0, 1fr))`,
          ...style,
        }}
      >
        {children}
      </div>
    );
  },
);

LearningCheckQuickEntryGrid.displayName = "LearningCheckQuickEntryGrid";

interface LearningCheckQuickEntryCardProps<Value extends string>
  extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  visualStatus: LearningCheckStatus;
  selectedValue: Value | null;
  choices: readonly LearningCheckQuickChoice<Value>[];
  choiceGroupLabel: string;
  disabled?: boolean;
  header: ReactNode;
  onChoice: (value: Value) => void;
}

/** Shared learning-check card and 3 × 2 one-touch choice pad. */
export function LearningCheckQuickEntryCard<Value extends string>({
  visualStatus,
  selectedValue,
  choices,
  choiceGroupLabel,
  disabled = false,
  header,
  onChoice,
  className,
  ...props
}: LearningCheckQuickEntryCardProps<Value>) {
  const statusStyle = LEARNING_CHECK_STATUS_STYLE[visualStatus];
  const fillerCount = (3 - (choices.length % 3)) % 3;

  return (
    <article
      {...props}
      className={cn(
        "relative z-10 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border transition-[border-color,background-color,box-shadow,opacity,transform]",
        statusStyle.card,
        className,
      )}
    >
      <div
        className={cn(
          "h-0.5 shrink-0 rounded-t-xl transition-colors",
          visualStatus === "unchecked" ? "bg-line/80" : statusStyle.dot,
        )}
        aria-hidden
      />
      {header}
      <div
        className="grid min-h-0 flex-1 grid-cols-3 auto-rows-[2.75rem] content-center gap-0.5 px-1"
        role="group"
        aria-label={choiceGroupLabel}
      >
        {choices.map((choice) => {
          const selected = selectedValue === choice.value;
          const choiceStyle = LEARNING_CHECK_STATUS_STYLE[choice.visualStatus];
          return (
            <button
              key={choice.value}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={choice.label}
              title={choice.shortcut ? `${choice.shortcut} · ${choice.label}` : choice.label}
              onClick={(event) => {
                event.stopPropagation();
                onChoice(choice.value);
              }}
              className={cn(
                "relative grid h-11 min-h-0 place-items-center rounded-lg border p-0 outline-none transition-[color,background-color,border-color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-crater focus-visible:ring-offset-1 focus-visible:ring-offset-card active:scale-95 disabled:opacity-55",
                selected
                  ? choiceStyle.active
                  : cn("border-transparent bg-paper/55 text-muted", choiceStyle.idle),
              )}
            >
              {choice.shortcut ? (
                <span className="absolute left-1 top-0.5 font-mono text-[9px] opacity-65" aria-hidden>
                  {choice.shortcut}
                </span>
              ) : null}
              <LearningCheckStatusIcon
                status={choice.visualStatus}
                size={17}
                className={cn(
                  "shrink-0",
                  selected ? "text-current opacity-80" : choiceStyle.icon,
                )}
              />
            </button>
          );
        })}
        {Array.from({ length: fillerCount }, (_, index) => (
          <span key={`choice-filler-${index}`} className="h-11" aria-hidden />
        ))}
      </div>
    </article>
  );
}
