import { Fragment, type ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface StatusStripItem {
  label: string;
  value: ReactNode;
  tone?: "default" | "warning" | "critical";
}

const TONE_CLASS: Record<NonNullable<StatusStripItem["tone"]>, string> = {
  default: "text-ink",
  warning: "text-amber-700 dark:text-amber-300",
  critical: "text-rose",
};

/** 一行 key→value 状态摘要（docs/plan/19-p4i-final.md §12.2 底部状态栏 / §13.5 教学准备）。 */
export function StatusStrip({ items, className }: { items: readonly StatusStripItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <div className={cn("flex min-h-10 shrink-0 flex-wrap items-center gap-3 border-t border-line px-1 py-2 text-xs", className)}>
      {items.map((item, index) => (
        <Fragment key={`${item.label}-${index}`}>
          {index > 0 ? <Separator orientation="vertical" className="h-3" /> : null}
          <div className="flex items-center gap-1.5">
            <span className="text-muted">{item.label}</span>
            <span className={cn("font-medium", TONE_CLASS[item.tone ?? "default"])}>{item.value}</span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
