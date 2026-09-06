"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type WechatStatusControlProps = {
  value: boolean | null;
  onChange: (value: boolean) => void;
  labels: { name: string; unknown: string; yes: string; no: string };
  disabled?: boolean;
};

export function WechatStatusControl({ value, onChange, labels, disabled }: WechatStatusControlProps) {
  const state = value === null ? "unknown" : value ? "yes" : "no";
  return <TooltipProvider delayDuration={200}>
    <ToggleGroup type="single" orientation="horizontal" dir="ltr" loop={false}
      value={state === "unknown" ? "" : state} disabled={disabled}
      aria-label={`${labels.name} · ${labels[state]}`} data-wechat-status={state}
      onValueChange={(next) => {
        // 中间位置保留未登记语义；重复点击已选项保持已有事实。
        if (!disabled && (next === "yes" || next === "no")) onChange(next === "yes");
      }}
      className={cn("relative h-8 w-22 shrink-0 gap-0 rounded-full bg-muted/10 ring-1 ring-inset ring-muted/20", disabled && "opacity-50")}>
      {(["yes", "no"] as const).map((choice) => <Tooltip key={choice}>
        <TooltipTrigger asChild>
          <ToggleGroupItem value={choice} aria-label={`${labels.name} · ${labels[choice]}`}
            className={cn("h-8 w-11 min-w-0 rounded-full p-0 data-[state=on]:bg-transparent focus-visible:z-10",
              choice === "yes" ? "hover:bg-leaf/20" : "hover:bg-rose/10")} />
        </TooltipTrigger>
        <TooltipContent>{labels.name} · {labels[choice]}</TooltipContent>
      </Tooltip>)}
      <span aria-hidden="true" data-wechat-thumb={state}
        className={cn("pointer-events-none absolute left-0.5 top-0.5 flex h-7 w-9 items-center justify-center rounded-full border bg-card transition-[translate,border-color] duration-200 motion-reduce:transition-none",
          state === "unknown" ? "translate-x-6 border-muted/30" : state === "yes" ? "translate-x-0 border-leaf-deep/70" : "translate-x-12 border-rose/70")}>
        <svg viewBox="0 0 24 24" className="size-5" fill="none" focusable="false">
          <g data-wechat-icon="unknown" className={cn("text-muted transition-opacity duration-200", state === "unknown" ? "opacity-100" : "opacity-0")}>
            <path fill="currentColor" fillRule="evenodd" d="M10 3C5.3 3 2 5.9 2 9.4c0 2 1.1 3.8 3 5L4.2 17l3.1-1.6c.7.2 1.5.3 2.3.3-.5-.9-.8-2-.8-3.1 0-3.6 3.4-6.4 7.6-6.4l.7.1C15.7 4.3 13 3 10 3ZM6.5 7.4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm5.4 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
            <path fill="currentColor" fillRule="evenodd" d="M16.4 7.7c-3.4 0-6.1 2.2-6.1 4.9s2.7 4.9 6.1 4.9c.6 0 1.2-.1 1.8-.2l2.3 1.3-.6-2c1.6-.9 2.6-2.4 2.6-4 0-2.7-2.7-4.9-6.1-4.9Zm-2.3 2.7a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Zm4.4 0a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z" />
          </g>
          <g data-wechat-icon="yes" className={cn("text-leaf-deep transition-opacity duration-200", state === "yes" ? "opacity-100" : "opacity-0")}>
            <path d="m5 12 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <g data-wechat-icon="no" className={cn("text-rose transition-opacity duration-200", state === "no" ? "opacity-100" : "opacity-0")}>
            <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </g>
        </svg>
      </span>
    </ToggleGroup>
  </TooltipProvider>;
}
