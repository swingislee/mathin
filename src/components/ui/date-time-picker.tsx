"use client";

import { useId, useState } from "react";
import { CalendarDays, Clock3 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type PickerMode = "date" | "datetime" | "time";

export interface DateTimePickerProps {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  mode?: PickerMode;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? parsed
    : undefined;
}

function datePart(value: Date) {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeParts(value: string) {
  const match = value.match(/(?:T|^)(\d{2}):(\d{2})/);
  return match ? { hour: match[1]!, minute: match[2]! } : { hour: "09", minute: "00" };
}

export function DateTimePicker({
  id,
  name,
  value,
  defaultValue = "",
  onValueChange,
  mode = "date",
  disabled,
  required,
  placeholder,
  className,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: DateTimePickerProps) {
  const generatedId = useId();
  const locale = useLocale();
  const t = useTranslations("common");
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const resolvedValue = value ?? internalValue;
  const selected = parseLocalDate(resolvedValue);
  const parts = timeParts(resolvedValue);
  const triggerId = id ?? generatedId;

  const update = (next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };

  const pickDate = (next: Date | undefined) => {
    if (!next) return;
    if (mode === "date") {
      update(datePart(next));
      setOpen(false);
      return;
    }
    update(`${datePart(next)}T${parts.hour}:${parts.minute}`);
  };

  const pickTime = (hour: string, minute: string) => {
    if (mode === "time") {
      update(`${hour}:${minute}`);
      return;
    }
    if (!selected) return;
    update(`${datePart(selected)}T${hour}:${minute}`);
  };

  const display = mode === "time" && /^\d{2}:\d{2}$/.test(resolvedValue)
    ? `${parts.hour}:${parts.minute}`
    : selected
    ? new Intl.DateTimeFormat(locale, mode === "datetime"
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" }).format(
        mode === "datetime"
          ? new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), Number(parts.hour), Number(parts.minute))
          : selected,
      )
    : null;

  return (
    <>
      {name ? <input type="hidden" name={name} value={resolvedValue} required={required} /> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={triggerId}
            type="button"
            disabled={disabled}
            aria-expanded={open}
            aria-describedby={ariaDescribedBy}
            data-invalid={ariaInvalid === true || ariaInvalid === "true" ? "true" : undefined}
            className={cn(
              "flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-left text-sm text-ink shadow-sm outline-none transition-[color,background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-crater/70 hover:bg-moon/20 focus-visible:ring-2 focus-visible:ring-crater/25 data-[invalid=true]:border-rose data-[invalid=true]:ring-2 data-[invalid=true]:ring-rose/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
              className,
            )}
          >
            {mode === "date" ? <CalendarDays className="size-4 shrink-0 text-muted" /> : <Clock3 className="size-4 shrink-0 text-muted" />}
            <span className={cn("min-w-0 flex-1 truncate", !display && "text-muted")}>{display ?? placeholder ?? t(mode === "datetime" ? "chooseDateTime" : mode === "time" ? "chooseTime" : "chooseDate")}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] p-3">
          {mode !== "time" ? <Calendar mode="single" selected={selected} defaultMonth={selected ?? new Date()} onSelect={pickDate} /> : null}
          <div className={cn("flex items-center gap-2", mode !== "time" && "mt-3 border-t border-line pt-3")}>
            {mode !== "time" ? <Button type="button" size="sm" variant="ghost" className="px-2" onClick={() => pickDate(new Date())}>{t("today")}</Button> : null}
            {resolvedValue ? <Button type="button" size="sm" variant="ghost" className="px-2 text-muted" onClick={() => update("")}>{t("clearDate")}</Button> : null}
            {mode !== "date" ? (
              <>
                <span className={cn("text-xs text-muted", mode !== "time" && "ml-auto")}>{t("time")}</span>
                <Select value={parts.hour} disabled={mode !== "time" && !selected} onValueChange={(hour) => pickTime(hour, parts.minute)}>
                  <SelectTrigger className="h-8 w-[4.5rem]"><SelectValue /></SelectTrigger>
                  <SelectContent>{Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0")).map((hour) => <SelectItem key={hour} value={hour}>{hour}</SelectItem>)}</SelectContent>
                </Select>
                <span className="text-muted">:</span>
                <Select value={parts.minute} disabled={mode !== "time" && !selected} onValueChange={(minute) => pickTime(parts.hour, minute)}>
                  <SelectTrigger className="h-8 w-[4.5rem]"><SelectValue /></SelectTrigger>
                  <SelectContent>{Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, "0")).map((minute) => <SelectItem key={minute} value={minute}>{minute}</SelectItem>)}</SelectContent>
                </Select>
                <Button type="button" size="sm" className="px-3" disabled={mode !== "time" && !selected} onClick={() => setOpen(false)}>{t("done")}</Button>
              </>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
