"use client";

import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";

/** 沿用学服姓名左侧的展开控件，所有层级保持相同尺寸与方向。 */
export function DashboardRowDisclosure({ expanded, label, controls, onToggle, onIntent }: {
  expanded: boolean; label: string; controls: string; onToggle: () => void; onIntent?: () => void;
}) {
  const ready = useHydrated();
  return <Button data-dashboard-row-disclosure type="button" size="sm" variant="ghost" className="size-5 shrink-0 rounded-sm p-0"
    disabled={!ready} aria-busy={!ready} onPointerEnter={onIntent} onFocus={onIntent}
    aria-expanded={expanded} aria-controls={controls} aria-label={label} onClick={onToggle}>
    {!ready ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
      : expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
  </Button>;
}
