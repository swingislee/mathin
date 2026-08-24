"use client";

import type { ReactNode } from "react";
import { LogOut, TriangleAlert } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export function ClassroomEndButton({
  label,
  disabled = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:bg-rose/10 hover:text-rose",
        disabled && "cursor-not-allowed opacity-55",
      )}
    >
      {label}
    </button>
  );
}

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
      className="flex h-10 min-w-0 items-center gap-1 px-1"
      data-classroom-course-info
      data-course-info-surface="flat"
      data-course-info-height="40"
    >
      <Link
        href={backHref}
        aria-label={exitLabel}
        title={exitLabel}
        className="grid size-10 shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-moon/40 hover:text-rose"
      >
        <LogOut aria-hidden size={20} strokeWidth={2.1} />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-xs font-medium" title={title}>{title}</h1>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-10 max-w-20 shrink-0 truncate rounded-full px-2 text-[11px] text-muted transition-colors hover:bg-moon/30 hover:text-ink"
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
              className="grid size-10 shrink-0 place-items-center rounded-full text-crater transition-colors hover:bg-crater/10"
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
      <ClassroomEndButton
        label={endLabel}
        disabled={endDisabled}
        onClick={onEnd}
      />
    </header>
  );
}
