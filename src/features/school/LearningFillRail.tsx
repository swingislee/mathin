"use client";

import { Check, LoaderCircle, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LearningCheckStatusIcon } from "./LearningCheckStatusIcon";
import {
  LEARNING_CHECK_STATUSES,
  type LearningCheckStatus,
} from "./session-learning-contract";
import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";

const FILL_STATUSES = LEARNING_CHECK_STATUSES.filter(
  (status): status is Exclude<LearningCheckStatus, "unchecked"> => status !== "unchecked",
);

export function LearningFillRail({
  remainingCount,
  totalCount,
  pending,
  canUndo,
  onFill,
  onUndo,
}: {
  remainingCount: number;
  totalCount: number;
  pending: boolean;
  canUndo: boolean;
  onFill: (status: Exclude<LearningCheckStatus, "unchecked">) => void;
  onUndo: () => void;
}) {
  const t = useTranslations("school.session");
  const completedCount = Math.max(0, totalCount - remainingCount);
  const progress = totalCount > 0 ? completedCount / totalCount : 1;
  const progressOffset = 100 - progress * 100;
  const progressLabel = remainingCount > 0
    ? t("learningFillRemaining", { count: remainingCount })
    : t("learningFillComplete");

  return (
    <aside
      aria-label={t("learningFillRail")}
      className="order-first mb-1 flex w-full shrink-0 items-center border-b border-line pb-1 sm:order-none sm:mb-0 sm:ml-1 sm:w-28 sm:flex-col sm:items-stretch sm:border-b-0 sm:border-l sm:py-1 sm:pb-0 sm:pl-1"
      data-learning-fill-rail
      data-learning-fill-width="112"
      data-learning-fill-layout="mobile-row-desktop-rail"
      data-learning-fill-remaining={remainingCount}
    >
      <div
        className="relative grid size-11 shrink-0 place-items-center self-center"
        aria-label={progressLabel}
        title={progressLabel}
        data-learning-fill-progress
      >
        <svg aria-hidden viewBox="0 0 44 44" className="absolute inset-0 size-11 -rotate-90">
          <circle cx="22" cy="22" r="18" pathLength="100" fill="none" stroke="currentColor" strokeWidth="2" className="text-line" />
          <circle
            cx="22"
            cy="22"
            r="18"
            pathLength="100"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="100"
            strokeDashoffset={progressOffset}
            className="text-leaf transition-[stroke-dashoffset] duration-200 motion-reduce:transition-none"
          />
        </svg>
        {pending
          ? <LoaderCircle aria-hidden size={16} className="animate-spin text-muted motion-reduce:animate-none" />
          : remainingCount > 0
            ? <span className="text-xs font-medium tabular-nums text-ink">{remainingCount}</span>
            : <Check aria-hidden size={17} className="text-leaf" />}
      </div>

      <div className="ml-1 flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:ml-0 sm:mt-1 sm:flex-none sm:flex-col sm:gap-1 sm:overflow-visible" role="toolbar" aria-label={t("learningFillRail")}>
        {FILL_STATUSES.map((status) => {
          const label = t("learningFillAction", {
            count: remainingCount,
            status: t("learningStatus_" + status),
          });
          return (
            <Button
              key={status}
              type="button"
              variant="ghost"
              size="sm"
              disabled={remainingCount === 0 || pending}
              aria-label={label}
              title={label}
              onClick={() => onFill(status)}
              className={cn(
                "size-10 shrink-0 justify-center gap-2 rounded-lg border border-transparent p-0 text-xs font-medium sm:h-11 sm:w-full sm:justify-start sm:px-2",
                LEARNING_CHECK_STATUS_STYLE[status].icon,
                LEARNING_CHECK_STATUS_STYLE[status].idle,
              )}
              data-learning-fill-action={status}
            >
              <LearningCheckStatusIcon status={status} size={18} className="shrink-0" />
              <span className="sr-only min-w-0 text-left leading-tight sm:not-sr-only">{t("learningStatus_" + status)}</span>
            </Button>
          );
        })}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canUndo || pending}
        aria-label={t("learningFillUndo")}
        title={t("learningFillUndo")}
        onClick={onUndo}
        className="ml-0.5 size-10 shrink-0 justify-center gap-2 rounded-lg border border-transparent p-0 text-xs font-medium text-muted hover:bg-moon/30 hover:text-ink sm:ml-0 sm:mt-auto sm:h-11 sm:w-full sm:justify-start sm:px-2"
        data-learning-fill-undo
      >
        <Undo2 aria-hidden size={18} className="shrink-0" />
        <span className="sr-only min-w-0 text-left leading-tight sm:not-sr-only">{t("learningFillUndo")}</span>
      </Button>
    </aside>
  );
}
