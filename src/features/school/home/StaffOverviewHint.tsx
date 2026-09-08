"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function StaffOverviewHint({ label, children }: { label: string; children: ReactNode }) {
  return <TooltipProvider delayDuration={200}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="size-6 shrink-0 p-0 text-muted" aria-label={label}>
          <Info className="size-3.5" aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-[min(22rem,calc(100vw-2rem))] whitespace-normal leading-5">
        {children}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>;
}
