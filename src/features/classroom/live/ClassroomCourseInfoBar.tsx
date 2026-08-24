"use client";

import type { ReactNode } from "react";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export function ClassroomCourseInfoBar({
  backHref,
  exitLabel,
  title,
  statusLabel,
  statusDetails,
  pageLabel,
  alertLabel,
  alertContent,
  endLabel,
  endDisabled = false,
  onEnd,
}: {
  backHref: string;
  exitLabel: string;
  title: string;
  statusLabel: string;
  statusDetails: ReactNode;
  pageLabel: string;
  alertLabel?: string;
  alertContent?: ReactNode;
  endLabel: string;
  endDisabled?: boolean;
  onEnd: () => void;
}) {
  return (
    <header
      className="flex h-12 min-w-0 items-center gap-1 rounded-2xl border border-line bg-card px-1.5"
      data-classroom-course-info
    >
      <Link
        href={backHref}
        aria-label={exitLabel}
        title={exitLabel}
        className="grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-moon/30 hover:text-ink"
      >
        <ArrowLeft aria-hidden size={17} />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-xs font-medium" title={title}>{title}</h1>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="min-h-11 max-w-20 shrink-0 truncate rounded-full px-2 text-[11px] text-muted transition-colors hover:bg-moon/30 hover:text-ink"
          >
            {statusLabel}
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-auto max-w-[min(24rem,calc(100vw-1.5rem))] p-3">
          {statusDetails}
        </PopoverContent>
      </Popover>

      {alertContent && alertLabel ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={alertLabel}
              title={alertLabel}
              className="grid size-11 shrink-0 place-items-center rounded-full text-crater transition-colors hover:bg-crater/10"
            >
              <TriangleAlert aria-hidden size={17} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="w-[min(28rem,calc(100vw-1.5rem))] p-3">
            {alertContent}
          </PopoverContent>
        </Popover>
      ) : null}

      <span className="shrink-0 font-mono text-[11px] text-muted" aria-label={pageLabel}>{pageLabel}</span>
      <button
        type="button"
        disabled={endDisabled}
        onClick={onEnd}
        className={cn(
          "min-h-11 shrink-0 rounded-full border border-rose/35 px-2.5 text-xs text-rose transition-colors hover:bg-rose/10",
          endDisabled && "cursor-not-allowed opacity-55",
        )}
      >
        {endLabel}
      </button>
    </header>
  );
}
