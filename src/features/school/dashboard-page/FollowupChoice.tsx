"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type FollowupTone = "healthy" | "neutral" | "attention" | "unhealthy";
export const followupToneClasses: Record<FollowupTone, string> = {
  healthy: "border-blue/30 bg-blue/15 text-blue",
  neutral: "border-line bg-line/20 text-muted",
  attention: "border-crater/40 bg-moon/40 text-ink",
  unhealthy: "border-rose/30 bg-rose/15 text-rose",
};

export function FollowupChoice({ value, onValueChange, options, label, disabled, className }: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly { value: string; label: string; tone?: FollowupTone }[];
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  if (options.length < 4) return <div role="group" aria-label={label} className={cn("flex min-w-0 flex-nowrap gap-1", className)}>
    {options.map((option) => <Button key={option.value} type="button" size="sm" variant="secondary" disabled={disabled}
      aria-pressed={value === option.value}
      title={option.label}
      className={cn("h-8 min-w-0 flex-1 truncate px-2 text-xs", value === option.value && followupToneClasses[option.tone ?? "neutral"])}
      onClick={() => onValueChange(option.value)}><span className="min-w-0 truncate">{option.label}</span></Button>)}
  </div>;
  const selected = options.find((option) => option.value === value);
  return <Select value={selected ? selected.value || "$unset" : ""} onValueChange={(next) => onValueChange(next === "$unset" ? "" : next)} disabled={disabled}>
    <SelectTrigger aria-label={label} title={selected?.label ?? label} className={cn("h-8 min-w-0 max-w-full gap-2 text-xs hover:translate-y-0 [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0", selected && followupToneClasses[selected.tone ?? "neutral"], className)}><SelectValue placeholder={label}>{selected?.label}</SelectValue></SelectTrigger>
    <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value || "$unset"} className={followupToneClasses[option.tone ?? "neutral"]}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}
