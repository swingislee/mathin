"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import { Check } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { fmt } from "./shared";
import { useLongPress } from "@/hooks/use-long-press";
import { SpatialIconButton } from "../spatial-interaction/SpatialWorkbenchControls";

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
export function ApplyField({ value, onApply, disabled, ariaLabel, applyLabel, unit, shortcut, min = 0 }: {
  value: number;
  onApply: (v: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
  applyLabel: string;
  unit: string;
  shortcut?: { value: number; label: string; icon: ReactNode };
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
    <span className="inline-flex shrink-0 items-center gap-1">
      <span className="inline-flex h-[30px] items-center rounded-md border border-line bg-card pr-2 focus-within:border-crater focus-within:ring-1 focus-within:ring-crater/25">
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
          className="h-full w-16 rounded-none border-0 bg-transparent px-2 py-0 text-right text-xs tabular-nums shadow-none focus-visible:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="min-w-5 text-right text-[11px] text-muted" aria-hidden>{unit}</span>
      </span>
      <SpatialIconButton label={applyLabel} disabled={disabled} onClick={apply}><Check aria-hidden /></SpatialIconButton>
      {shortcut && <SpatialIconButton label={shortcut.label} className="text-ink" disabled={disabled} onClick={() => {
        setText(String(shortcut.value));
        onApply(shortcut.value);
      }}>{shortcut.icon}</SpatialIconButton>}
    </span>
  );
}
