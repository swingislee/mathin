"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { WechatStatusGlyph } from "./WechatStatusGlyph";

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
    <ToggleGroup type="single" orientation="horizontal" dir="ltr" loop={false}
      value={state} disabled={disabled}
      aria-label={`${labels.name} · ${labels[state]}`} data-wechat-status={state}
      onValueChange={(next) => {
        if (disabled) return;
        if (next === "unknown" || next === "") onChange(null);
        else if (next === "yes" || next === "no") onChange(next === "yes");
      }}
      className={cn("relative isolate h-8 w-18 shrink-0 gap-0 text-muted", disabled && "opacity-50")}>
      <span aria-hidden="true" data-wechat-rail className="pointer-events-none absolute inset-x-3 top-1/2 h-px bg-muted/25" />
      {(["yes", "unknown", "no"] as const).map((choice) => <Tooltip key={choice}>
        <ToggleGroupItem value={choice} asChild
          className="relative h-8 w-6 min-w-0 cursor-pointer rounded-full p-0 hover:bg-muted/8 data-[state=on]:bg-transparent focus-visible:z-10 [&_svg]:size-3">
          <TooltipTrigger aria-label={`${labels.name} · ${labels[choice]}`}>
            {choice === "unknown" ? <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className="size-3 bg-card text-muted/45"><WechatGlyph /></svg>
              : <span aria-hidden="true" className="size-0.5 rounded-full bg-muted/50" />}
          </TooltipTrigger>
        </ToggleGroupItem>
        <TooltipContent>{labels.name} · {labels[choice]}</TooltipContent>
      </Tooltip>)}
      <span aria-hidden="true" data-wechat-thumb={state}
        className={cn("pointer-events-none absolute left-0.5 top-1.5 flex size-5 items-center justify-center rounded-full transition-[translate,background-color,color] duration-200 motion-reduce:transition-colors",
          state === "unknown" ? "translate-x-6 bg-card text-muted" : state === "yes" ? "translate-x-0 bg-leaf/25 text-leaf-deep" : "translate-x-12 bg-rose/15 text-rose-deep")}>
        <WechatStatusGlyph state={state} />
      </span>
    </ToggleGroup>
  </TooltipProvider>;
}
