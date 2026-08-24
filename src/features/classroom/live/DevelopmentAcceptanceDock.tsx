"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Development-only manual acceptance controls.
 *
 * The dock is fixed outside the classroom layout flow so opening it never
 * changes the dimensions of the stage, side board, roster, or control bar.
 */
export function DevelopmentAcceptanceDock({
  title,
  collapseLabel,
  expandLabel,
  children,
  className,
}: {
  title: string;
  collapseLabel: string;
  expandLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <aside
      className={cn(
        "fixed left-[max(.75rem,env(safe-area-inset-left))] top-[max(.75rem,env(safe-area-inset-top))] z-[90] w-[min(34rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-blue/35 bg-paper/95 text-xs shadow-xl backdrop-blur",
        className,
      )}
      data-development-acceptance-dock
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="development-acceptance-dock-content"
        aria-label={expanded ? collapseLabel : expandLabel}
        title={expanded ? collapseLabel : expandLabel}
        onClick={() => setExpanded((current) => !current)}
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left font-medium text-ink transition-colors hover:bg-moon/30"
      >
        <FlaskConical aria-hidden size={16} className="shrink-0 text-blue" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {expanded ? <ChevronUp aria-hidden size={16} /> : <ChevronDown aria-hidden size={16} />}
      </button>
      {expanded && (
        <div
          id="development-acceptance-dock-content"
          className="max-h-[min(72dvh,38rem)] overflow-y-auto border-t border-line p-2 overscroll-contain"
        >
          {children}
        </div>
      )}
    </aside>
  );
}
