"use client";

import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 图标承载字段名称，悬停、键盘聚焦和读屏均可读取完整标签。 */
export function FollowupFieldIcon({ icon: Icon, label, id, className }: { icon: LucideIcon; label: string; id?: string; className?: string }) {
  return <TooltipProvider delayDuration={200}><Tooltip>
    <TooltipTrigger asChild>
      <span id={id} role="img" aria-label={label} tabIndex={0} data-followup-field-icon
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crater">
        <Icon className={cn("size-5", className)} aria-hidden="true" />
      </span>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip></TooltipProvider>;
}
