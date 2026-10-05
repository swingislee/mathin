import {
  addCalendarDays, calendarDayKey, dateTimeInputToInstant, startOfDay, startOfMonth, startOfWeek,
  zonedDateParts, zonedDateTimeToInstant,
} from "./schedule";
import { effectiveTeachingCalendarEntry, type TeachingCalendarEntryV2 } from "./teaching-calendar";
import type { CalendarSchoolWindow } from "./calendar-contract";
export type { CalendarSchoolWindow } from "./calendar-contract";

export type CalendarView = "day" | "week" | "month" | "year";
export type CalendarItemKind = "lesson" | "availability" | "meeting" | "task" | "preparation" | "strategy" | "milestone";
export const CALENDAR_KINDS: CalendarItemKind[] = ["lesson", "availability", "meeting", "task", "preparation", "strategy", "milestone"];

export interface CalendarItem {
  id: string;
  sourceId: string;
  kind: CalendarItemKind;
  title: string;
  startsAt: string;
  endsAt: string;
  subtitle?: string;
  detail?: string;
  state?: string;
  muted?: boolean;
  conflict?: boolean;
  pending?: boolean;
  canResize?: boolean;
}

export const CALENDAR_TONES: Record<CalendarItemKind, { block: string; dot: string }> = {
  lesson: { block: "border-crater bg-crater/15 text-ink", dot: "bg-crater" },
  availability: { block: "border-leaf-deep/60 bg-leaf/20 text-ink", dot: "bg-leaf-deep" },
  meeting: { block: "border-rose/55 bg-cheek/30 text-ink", dot: "bg-rose" },
  task: { block: "border-crater/60 bg-moon/45 text-ink", dot: "bg-moon ring-1 ring-crater/60" },
  preparation: { block: "border-leaf-deep/45 bg-leaf/10 text-ink", dot: "bg-leaf" },
  strategy: { block: "border-crater bg-moon/60 text-ink", dot: "bg-crater" },
  milestone: { block: "border-rose bg-cheek/20 text-rose-deep", dot: "bg-rose" },
};

export function calendarAnchor(value: string, timeZone: string): Date {
  return dateTimeInputToInstant(`${value}T12:00`, timeZone) ?? new Date();
}

export function calendarRange(anchor: string, view: CalendarView, timeZone: string) {
  const date = calendarAnchor(anchor, timeZone);
  if (view === "year") {
    const { year } = zonedDateParts(date, timeZone);
    const start = zonedDateTimeToInstant({ year, month: 0, day: 1 }, timeZone);
    const end = zonedDateTimeToInstant({ year: year + 1, month: 0, day: 1 }, timeZone);
    const count = Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000);
    return { start, end, days: Array.from({ length: count }, (_, index) => addCalendarDays(start, index, timeZone)) };
  }
  const start = view === "day" ? startOfDay(date, timeZone)
    : view === "week" ? startOfWeek(date, timeZone) : startOfWeek(startOfMonth(date, timeZone), timeZone);
  const count = view === "day" ? 1 : view === "week" ? 7 : 42;
  return {
    start, end: addCalendarDays(start, count, timeZone),
    days: Array.from({ length: count }, (_, index) => addCalendarDays(start, index, timeZone)),
  };
}

export function shiftCalendarAnchor(anchor: string, view: CalendarView, direction: number, timeZone: string): string {
  const date = calendarAnchor(anchor, timeZone);
  if (view === "year") {
    const { year } = zonedDateParts(date, timeZone);
    return `${year + direction}-01-01`;
  }
  if (view !== "month") return calendarDayKey(addCalendarDays(date, direction * (view === "week" ? 7 : 1), timeZone), timeZone);
  const { year, month } = zonedDateParts(date, timeZone);
  return calendarDayKey(zonedDateTimeToInstant({ year, month: month + direction, day: 1, hour: 12 }, timeZone), timeZone);
}

/** Resolve wall-clock half-hour boundaries, including the next day's midnight. */
export function calendarTimeAt(day: string, minutes: number, timeZone: string): Date | null {
  const offset = Math.floor(minutes / 1440);
  const withinDay = ((minutes % 1440) + 1440) % 1440;
  const key = calendarDayKey(addCalendarDays(calendarAnchor(day, timeZone), offset, timeZone), timeZone);
  return dateTimeInputToInstant(`${key}T${String(Math.floor(withinDay / 60)).padStart(2, "0")}:${String(withinDay % 60).padStart(2, "0")}`, timeZone);
}

/** Campus overrides and mapped teaching days reuse the school's existing calendar. */
export function calendarDayContext(day: Date, timeZone: string, campusId: string | null,
  entries: readonly TeachingCalendarEntryV2[], windows: readonly CalendarSchoolWindow[], items: CalendarItem[]) {
  const key = calendarDayKey(day, timeZone);
  const entry = effectiveTeachingCalendarEntry(entries, key, campusId);
  const notices = campusId ? entry ? [entry] : [] : entries.filter(value => value.startsOn <= key && value.endsOn >= key);
  const closed = entry?.kind === "closed";
  const weekday = entry?.scheduleMode === "mapped" && entry.mappedWeekday !== null ? entry.mappedWeekday : zonedDateParts(day, timeZone).weekday;
  const periods = closed ? [] : windows.filter(window => window.weekday === weekday).map(window => ({ from: window.startMinute, to: window.endMinute }));
  if (!closed) layoutCalendarDay(items.filter(item => item.kind === "lesson"), day, timeZone)
    .forEach(item => periods.push({ from: item.fromMinute, to: item.toMinute }));
  return { entry, notices, closed, periods, schoolTime: (minute: number) => periods.some(period => period.from < minute + 30 && period.to > minute) };
}

export function calendarItemsForDay(items: CalendarItem[], day: Date, timeZone: string): CalendarItem[] {
  const start = startOfDay(day, timeZone).getTime();
  const end = addCalendarDays(startOfDay(day, timeZone), 1, timeZone).getTime();
  return items.filter(item => Date.parse(item.startsAt) < end && Date.parse(item.endsAt) > start)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
}

/** Split overlapping events into lanes, clipping overnight events at the visible day's edges. */
export function layoutCalendarDay(items: CalendarItem[], day: Date, timeZone: string) {
  const start = startOfDay(day, timeZone).getTime();
  const end = addCalendarDays(startOfDay(day, timeZone), 1, timeZone).getTime();
  const entries = calendarItemsForDay(items, day, timeZone).map(item => {
    const a = Math.max(start, Date.parse(item.startsAt));
    const b = Math.min(end, Date.parse(item.endsAt));
    const from = zonedDateParts(new Date(a), timeZone);
    const to = zonedDateParts(new Date(b), timeZone);
    return { item, start: a, end: b, fromMinute: from.hour * 60 + from.minute, toMinute: b === end ? 1440 : to.hour * 60 + to.minute };
  });
  const clusters: typeof entries[] = [];
  let cluster: typeof entries = [];
  let clusterEnd = -Infinity;
  for (const entry of entries) {
    if (cluster.length && entry.start >= clusterEnd) { clusters.push(cluster); cluster = []; clusterEnd = -Infinity; }
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.end);
  }
  if (cluster.length) clusters.push(cluster);
  return clusters.flatMap(group => {
    const ends: number[] = [];
    const placed = group.map(entry => {
      let lane = ends.findIndex(value => value <= entry.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = entry.end;
      return { ...entry, lane };
    });
    return placed.map(entry => ({ ...entry, lanes: ends.length }));
  });
}
