"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CalendarRecurrence } from "./calendar-contract";

export interface CalendarRecurrenceDraft {
  frequency: "none" | CalendarRecurrence["frequency"];
  interval: string;
  until: string;
}

export function newCalendarRecurrenceDraft(startDate: string): CalendarRecurrenceDraft {
  const until = new Date(`${startDate}T12:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 90);
  return { frequency: "none", interval: "1", until: Number.isFinite(until.getTime()) ? until.toISOString().slice(0, 10) : startDate };
}

function recurrenceUntilLimit(startDate: string): string {
  const until = new Date(`${startDate}T12:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 370);
  return Number.isFinite(until.getTime()) ? until.toISOString().slice(0, 10) : startDate;
}

/** null means one event; undefined means the repeat fields need correction. */
export function calendarRecurrenceInput(draft: CalendarRecurrenceDraft, startDate: string, timeZone: string): CalendarRecurrence | null | undefined {
  if (draft.frequency === "none") return null;
  const interval = Number(draft.interval);
  const date = new Date(`${draft.until}T12:00:00Z`);
  if (!Number.isInteger(interval) || interval < 1 || interval > 12
    || !/^\d{4}-\d{2}-\d{2}$/.test(draft.until) || !Number.isFinite(date.getTime())
    || date.toISOString().slice(0, 10) !== draft.until || draft.until < startDate
    || draft.until > recurrenceUntilLimit(startDate)) return undefined;
  return { frequency: draft.frequency, interval, until: draft.until, timeZone };
}

interface Props {
  draft: CalendarRecurrenceDraft;
  startDate: string;
  prefix: string;
  disabled?: boolean;
  onChange: (draft: CalendarRecurrenceDraft) => void;
}

export function CalendarRecurrenceFields({ draft, startDate, prefix, disabled = false, onChange }: Props) {
  const t = useTranslations("school.calendar");
  return <fieldset disabled={disabled} className="space-y-3">
    <div className="space-y-1.5">
      <Label htmlFor={`${prefix}-frequency`}>{t("repeat")}</Label>
      <Select value={draft.frequency} disabled={disabled}
        onValueChange={frequency => onChange({ ...draft, frequency: frequency as CalendarRecurrenceDraft["frequency"],
          until: draft.until < startDate ? newCalendarRecurrenceDraft(startDate).until : draft.until })}>
        <SelectTrigger id={`${prefix}-frequency`}><SelectValue /></SelectTrigger>
        <SelectContent>{(["none", "daily", "weekly", "monthly"] as const).map(frequency =>
          <SelectItem key={frequency} value={frequency}>{t(`repeat_${frequency}`)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    {draft.frequency !== "none" ? <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${prefix}-interval`}>{t("repeatInterval")}</Label>
          <div className="flex items-center gap-2">
            <Input id={`${prefix}-interval`} className="min-w-0" type="number" required min={1} max={12} step={1}
              value={draft.interval} onChange={event => onChange({ ...draft, interval: event.target.value })} />
            <span className="shrink-0 text-sm text-muted">{t(`repeatUnit_${draft.frequency}`, { count: Number(draft.interval) || 1 })}</span>
          </div>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${prefix}-until`}>{t("repeatUntil")}</Label>
          <Input id={`${prefix}-until`} type="date" required min={startDate} max={recurrenceUntilLimit(startDate)} value={draft.until}
            onChange={event => onChange({ ...draft, until: event.target.value })} />
        </div>
      </div>
      <p className="text-xs text-muted">{t("repeatCreationHint")}</p>
      {draft.frequency === "monthly" ? <p className="text-xs text-muted">{t("repeatMonthlyHint")}</p> : null}
    </> : null}
  </fieldset>;
}
