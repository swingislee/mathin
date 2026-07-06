"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** 数字输入：内部持有文本态，失焦/回车时提交，外部值变化时同步 */
export function NumField({ value, onCommit, onFocusField, disabled, className, ariaLabel }: {
  value: number;
  onCommit: (v: number) => void;
  /** 获得焦点时回调（行程工具用于立即轮转「自动」求解框） */
  onFocusField?: () => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (!focused) setText(String(value));
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      value={text}
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={() => {
        setFocused(true);
        onFocusField?.();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const v = Number(text);
        if (Number.isFinite(v) && v >= 0) onCommit(v);
        else setText(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={cn(
        "w-16 rounded-md border bg-card px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:ring-1 focus:ring-[var(--rose)] disabled:opacity-50",
        className,
      )}
    />
  );
}

/** 带「确认」按钮的数字输入：触摸屏友好（回车或点 ✓ 提交） */
export function ApplyField({ value, onApply, disabled, ariaLabel, applyLabel }: {
  value: number;
  onApply: (v: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
  applyLabel: string;
}) {
  const [text, setText] = useState(String(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(String(value));
  }
  const apply = () => {
    const v = Number(text);
    if (Number.isFinite(v)) onApply(v);
    else setText(String(value));
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
        }}
        className="w-16 rounded-md border bg-card px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:ring-1 focus:ring-[var(--rose)] disabled:opacity-50"
      />
      <button
        type="button"
        aria-label={applyLabel}
        title={applyLabel}
        disabled={disabled}
        onClick={apply}
        className="grid size-6 shrink-0 place-items-center rounded-full border border-crater text-muted transition-colors duration-200 hover:bg-moon/50 hover:text-ink disabled:opacity-50"
      >
        <Check size={12} />
      </button>
    </span>
  );
}
