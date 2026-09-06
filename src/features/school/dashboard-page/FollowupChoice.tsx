"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type FollowupTone = "healthy" | "neutral" | "attention" | "unhealthy";
export const followupToneClasses: Record<FollowupTone, string> = {
  healthy: "border-leaf-deep/30 bg-leaf/15 text-ink",
  neutral: "border-line bg-card text-ink",
  attention: "border-crater/40 bg-moon/40 text-ink",
  unhealthy: "border-rose/30 bg-rose/15 text-rose",
};
const toneDot: Record<FollowupTone, string> = {
  healthy: "bg-leaf-deep", neutral: "bg-muted", attention: "bg-[var(--followup-outline)]", unhealthy: "bg-rose",
};

export function FollowupChoice({ value, onValueChange, options, label, disabled, className }: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly { value: string; label: string; tone?: FollowupTone }[];
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  if (options.length < 4) return <div role="group" aria-label={label} className={cn("flex min-w-0 flex-wrap gap-1.5", className)}>
    {options.map((option) => <Button key={option.value} type="button" size="sm" variant="secondary" disabled={disabled}
      aria-pressed={value === option.value}
      title={option.label}
      className={cn("h-auto min-h-9 min-w-0 max-w-full whitespace-normal bg-card px-3 py-1.5 text-xs leading-5", value === option.value && "border-ink/50 text-ink")}
      onClick={() => onValueChange(option.value)}>
      <span aria-hidden="true" className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-full border", value === option.value ? "border-ink text-ink" : "border-line")}>
        {value === option.value ? <Check className="size-2.5" /> : null}
      </span><span className="min-w-0 break-words">{option.label}</span></Button>)}
  </div>;
  const selected = options.find((option) => option.value === value);
  return <Select value={selected ? selected.value || "$unset" : ""} onValueChange={(next) => onValueChange(next === "$unset" ? "" : next)} disabled={disabled}>
    <SelectTrigger aria-label={label} title={selected?.label ?? label} className={cn("h-auto min-h-9 min-w-0 max-w-full gap-2 whitespace-normal bg-card py-1.5 text-left text-xs leading-5 text-ink hover:translate-y-0 [&>span]:min-w-0 [&>span]:line-clamp-none [&>span]:break-words [&>svg]:shrink-0", className)}>
      <SelectValue placeholder={label}>{selected ? <span className="flex items-center gap-2">
        {selected.tone ? <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", toneDot[selected.tone])} /> : null}
        <span>{selected.label}</span>
      </span> : null}</SelectValue>
    </SelectTrigger>
    <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value || "$unset"} className="whitespace-normal break-words">{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}
