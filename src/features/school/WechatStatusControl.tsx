"use client";

import { Check, X } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type WechatStatusControlProps = {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  labels: { name: string; unknown: string; yes: string; no: string };
  disabled?: boolean;
};

function WechatGlyph() {
  return <>
    <path fill="currentColor" fillRule="evenodd" d="M10 3C5.3 3 2 5.9 2 9.4c0 2 1.1 3.8 3 5L4.2 17l3.1-1.6c.7.2 1.5.3 2.3.3-.5-.9-.8-2-.8-3.1 0-3.6 3.4-6.4 7.6-6.4l.7.1C15.7 4.3 13 3 10 3ZM6.5 7.4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm5.4 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
    <path fill="currentColor" fillRule="evenodd" d="M16.4 7.7c-3.4 0-6.1 2.2-6.1 4.9s2.7 4.9 6.1 4.9c.6 0 1.2-.1 1.8-.2l2.3 1.3-.6-2c1.6-.9 2.6-2.4 2.6-4 0-2.7-2.7-4.9-6.1-4.9Zm-2.3 2.7a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Zm4.4 0a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z" />
  </>;
}

export function WechatStatusControl({ value, onChange, labels, disabled }: WechatStatusControlProps) {
  const state = value === null ? "unknown" : value ? "yes" : "no";
  return <TooltipProvider delayDuration={200}>
    <ToggleGroup type="single" orientation="horizontal" dir="ltr" loop={false} size="sm"
      value={value === null ? "" : state} disabled={disabled}
      aria-label={`${labels.name} · ${labels[state]}`} data-wechat-status={state}
      onValueChange={(next) => {
        if (disabled) return;
        if (next === "") onChange(null);
        else if (next === "yes" || next === "no") onChange(next === "yes");
      }}
      className="h-8 shrink-0 justify-start gap-1">
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" data-wechat-icon
        className={cn("mr-1 size-5 shrink-0 text-leaf", disabled && "opacity-50")}><WechatGlyph /></svg>
      {(["yes", "no"] as const).map((choice) => <Tooltip key={choice}>
        <ToggleGroupItem value={choice} asChild
          className={cn("size-8 min-w-8 cursor-pointer border border-transparent bg-muted/6 p-0 text-xs text-muted data-[state=on]:font-semibold data-[state=on]:text-[var(--followup-choice-ink)]",
            choice === "yes" ? "hover:bg-leaf/20 data-[state=on]:border-leaf-deep/40 data-[state=on]:bg-leaf" : "hover:bg-rose/15 data-[state=on]:border-rose-deep/40 data-[state=on]:bg-rose/85")}>
          <TooltipTrigger aria-label={`${labels.name} · ${labels[choice]}`}>
            {choice === "yes" ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
          </TooltipTrigger>
        </ToggleGroupItem>
        <TooltipContent>{labels.name} · {labels[choice]}</TooltipContent>
      </Tooltip>)}
    </ToggleGroup>
  </TooltipProvider>;
}
