"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 沿用学服姓名左侧的展开控件，所有层级保持相同尺寸与方向。 */
export function DashboardRowDisclosure({ expanded, label, controls, onToggle }: {
  expanded: boolean; label: string; controls: string; onToggle: () => void;
}) {
  return <Button type="button" size="sm" variant="ghost" className="size-5 shrink-0 rounded-sm p-0"
    aria-expanded={expanded} aria-controls={controls} aria-label={label} onClick={onToggle}>
    {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
  </Button>;
}
