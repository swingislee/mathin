"use client";

import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function StaffOverviewDataNote({
  triggerLabel,
  title,
  rows,
  status,
  statusDetail,
  limited,
}: {
  triggerLabel: string;
  title: string;
  rows: Array<{ label: string; value: string }>;
  status: string;
  statusDetail: string;
  limited: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-8 shrink-0 p-0"
          aria-label={triggerLabel}
          title={triggerLabel}
        >
          <Info className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label={title}
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-3"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-ink">{title}</h2>
          <Badge variant={limited ? "outline" : "secondary"}>{status}</Badge>
        </div>
        <dl className="space-y-2 text-xs">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
              <dt className="text-muted">{row.label}</dt>
              <dd className="text-right tabular-nums text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-line/70 pt-2 text-[11px] leading-5 text-muted">{statusDetail}</p>
      </PopoverContent>
    </Popover>
  );
}
