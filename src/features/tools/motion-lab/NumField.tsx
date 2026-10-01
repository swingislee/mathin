"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import { Check } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fmt } from "./shared";
import { useLongPress } from "@/hooks/use-long-press";

function parseNumber(text: string, min = 0) {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= min && value <= 1e9 ? fmt(value) : null;
}

/** 数字输入：内部持有文本态，失焦/回车时提交，外部值变化时同步 */
type NumFieldProps = {
  value: number;
  onCommit: (v: number) => void;
  onFinish?: () => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  min?: number;
};

export function NumField({ value, onCommit, onFinish, disabled, className, ariaLabel, autoFocus, min = 0 }: NumFieldProps) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const [prevValue, setPrevValue] = useState(value);
  const cancelled = useRef(false);
  if (value !== prevValue) {
    setPrevValue(value);
    if (!focused) setText(String(value));
  }
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={min}
      max={1e9}
      step="any"
      autoFocus={autoFocus}
      value={text}
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={(event) => {
        cancelled.current = false;
        setFocused(true);
        event.currentTarget.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const v = parseNumber(text, min);
        setText(String(value));
        if (!cancelled.current && v !== null) onCommit(v);
        onFinish?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancelled.current = e.key === "Escape";
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "w-16 rounded-md border bg-card px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:ring-1 focus:ring-[var(--rose)] disabled:opacity-50",
        className,
      )}
    />
  );
}

/** 沿用旧版数字区：短按进入编辑，长按直接恢复该字段的教学起点。 */
export function EditableNumber({ longPressValue, longPressLabel, ...props }: NumFieldProps & {
  longPressValue: number;
  longPressLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const press = useLongPress({
    onClick: () => setEditing(true), onLongPress: () => props.onCommit(longPressValue), disabled: props.disabled,
  });
  if (editing) return <NumField {...props} autoFocus onFinish={() => setEditing(false)} />;
  return (
    <Button {...press} type="button" variant="ghost" disabled={props.disabled}
      aria-label={props.ariaLabel} title={longPressLabel}
      className={cn("w-16 touch-none select-none justify-end rounded-md border bg-card px-1.5 py-0.5 text-xs tabular-nums text-ink", props.className)}>
      {props.value}
    </Button>
  );
}

/** 带「确认」按钮的数字输入：触摸屏友好（回车或点 ✓ 提交） */
export function ApplyField({ value, onApply, disabled, ariaLabel, applyLabel, min = 0 }: {
  value: number;
  onApply: (v: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
  applyLabel: string;
  min?: number;
}) {
  const [text, setText] = useState(String(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(String(value));
  }
  const apply = () => {
    const v = parseNumber(text, min);
    setText(String(v ?? value));
    if (v !== null) onApply(v);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <Input
        type="number"
        inputMode="decimal"
        min={min}
        max={1e9}
        step="any"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Enter") apply();
            else setText(String(value));
          }
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
