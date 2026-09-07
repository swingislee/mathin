"use client";

import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDashboardPreference } from "./dashboard-page/DashboardPreferenceScope";

/** 标题栏工作队列：按内容横排，整项换行；与行内登记选择器分开。 */
export function FollowupPrimaryFilter({ label, value, options, onValueChange, disabled }: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  return <ToggleGroup type="single" orientation="horizontal" aria-label={label} value={value}
    disabled={disabled} onValueChange={next => { if (next && next !== value) onValueChange(next); }}
    data-followup-primary-filter className="w-fit max-w-full flex-none flex-wrap justify-start gap-1" size="sm">
    {options.map(option => <ToggleGroupItem key={option.value} value={option.value} disabled={option.disabled}
      className="h-8 flex-none whitespace-nowrap rounded-full border border-transparent px-3 text-xs text-muted data-[state=on]:border-crater/60 data-[state=on]:bg-moon/40 data-[state=on]:text-ink">
      {option.label}
    </ToggleGroupItem>)}
  </ToggleGroup>;
}

/** 仅记住当前账号的工作队列；旧偏好或无效值回到全部。 */
export function useFollowupWorkFilter<T extends string>(key: string, options: readonly T[], fallback: T): [T, (value: T) => void] {
  const preference = useDashboardPreference(`followup-primary:${key}`);
  const [local, setLocal] = useState(fallback);
  let value = local;
  try {
    const stored = preference.raw ? JSON.parse(preference.raw) : null;
    if (options.includes(stored)) value = stored;
  } catch { /* 使用当前页面的有效选择。 */ }
  return [value, next => { setLocal(next); preference.save(next); }];
}
