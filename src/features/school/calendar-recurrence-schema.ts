import { z } from "zod";
import type { CalendarRecurrence } from "./calendar-contract";

export const calendarRecurrenceSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().min(1).max(12),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }),
  timeZone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
    catch { return false; }
  }),
}).strict();

export function calendarRecurrenceWithinRange(startsAt: string, recurrence: CalendarRecurrence | null | undefined): boolean {
  if (!recurrence) return true;
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: recurrence.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(startsAt));
  const part = (name: string) => parts.find(value => value.type === name)?.value;
  const startDay = `${part("year")}-${part("month")}-${part("day")}`;
  const days = (Date.parse(recurrence.until) - Date.parse(startDay)) / 86_400_000;
  return days >= 0 && days <= 370;
}
