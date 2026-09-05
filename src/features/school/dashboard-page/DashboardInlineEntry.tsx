"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 表格内连续录入的共享展开容器；保留当前记录及周围行的位置。 */
export function DashboardInlineEntry({
  children,
  title,
  closeLabel,
  onClose,
  onSubmit,
  pending = false,
  autoFocus = false,
  flush = false,
}: {
  children: ReactNode;
  title?: string;
  closeLabel?: string;
  onClose?: () => void;
  onSubmit?: () => void;
  pending?: boolean;
  autoFocus?: boolean;
  flush?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) {
      ref.current?.closest("tr")?.scrollIntoView({ block: "nearest", inline: "nearest" });
      ref.current?.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
    }
  }, [autoFocus]);

  return (
    <div
      ref={ref}
      data-dashboard-inline-entry
      role={title ? "region" : undefined}
      aria-label={title}
      aria-busy={pending}
      className={cn("min-w-0", !flush && "mt-2 space-y-2 border-t border-line pt-2")}
      onKeyDown={onSubmit ? (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          if (!pending) onSubmit();
        }
      } : undefined}
    >
      {title || onClose ? <div className="flex items-center justify-between gap-3">
        {title ? <h3 className="text-xs font-medium text-ink">{title}</h3> : <span />}
        {onClose ? <Button type="button" size="sm" variant="ghost" className="size-7 p-0" disabled={pending} aria-label={closeLabel} onClick={onClose}><X className="size-3.5" /></Button> : null}
      </div> : null}
      {children}
    </div>
  );
}
