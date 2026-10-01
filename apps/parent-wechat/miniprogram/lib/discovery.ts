import type { Activity, Booking } from "./api-types";
import type { Locale } from "./locale";

export type DateFilter = "all" | "week" | "month";
export type ActivityFilter = { search: string; location: string; period: DateFilter; availableOnly: boolean };
export function canReserve(activity: Pick<Activity, "bookable" | "remaining">) {
  return activity.bookable && activity.remaining !== 0;
}
export function canCancel(booking: Pick<Booking, "status" | "startsAt">, now = Date.now()) {
  return booking.status === "booked" && Date.parse(booking.startsAt) > now;
}
export function filterActivities(rows: Activity[], filter: ActivityFilter, locale: Locale, now = Date.now()) {
  const search = filter.search.trim().toLocaleLowerCase();
  const today = new Date(now);
  const end = filter.period === "week"
    ? new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).getTime()
    : filter.period === "month" ? new Date(today.getFullYear(), today.getMonth() + 1, 1).getTime() : Infinity;
  return rows.filter(row => {
    const starts = Date.parse(row.startsAt);
    return starts > now && starts < end
      && (!filter.location || row.location === filter.location)
      && (!filter.availableOnly || canReserve(row))
      && (!search || [row.title[locale] || row.title.zh, row.description[locale] || row.description.zh, row.location]
        .join(" ").toLocaleLowerCase().includes(search));
  }).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export function dateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function monthRange(month: string) {
  const [year, number] = month.split("-").map(Number);
  return { from: new Date(year, number - 1, 1).toISOString(), to: new Date(year, number, 1).toISOString() };
}
export function shiftMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  return dateKey(new Date(year, number - 1 + offset, 1)).slice(0, 7);
}
export function weekRange(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value + "T12:00:00");
  const offset = (date.getDay() + 6) % 7;
  const from = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
  return { from: from.toISOString(), to: to.toISOString() };
}
export function weekDays(selected: string, eventDates: string[], now = new Date()) {
  const first = new Date(weekRange(selected).from);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
    const key = dateKey(date);
    return { date: key, day: String(date.getDate()), weekday: index,
      selected: key === selected, today: key === dateKey(now), count: eventDates.filter(value => dateKey(value) === key).length };
  });
}
export function timeLabel(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
export function sessionTimes(value: { startsAt: string; durationMinutes: number | null }, now = Date.now()) {
  const starts = Date.parse(value.startsAt);
  const ends = value.durationMinutes === null ? null : starts + value.durationMinutes * 60_000;
  return { startTime: timeLabel(value.startsAt), endTime: ends === null ? "" : timeLabel(new Date(ends).toISOString()),
    phase: ends !== null && ends <= now ? "ended" : starts <= now ? (ends === null ? "started" : "ongoing") : "upcoming" };
}
export function calendarDays(month: string, eventDates: string[], selected: string, now = new Date()) {
  const [year, number] = month.split("-").map(Number);
  const first = new Date(year, number - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(year, number, 0).getDate();
  const total = Math.ceil((offset + count) / 7) * 7;
  const counts = new Map<string, number>();
  eventDates.forEach(value => { const key = dateKey(value); counts.set(key, (counts.get(key) || 0) + 1); });
  return Array.from({ length: total }, (_, index) => {
    const day = index - offset + 1;
    const key = day > 0 && day <= count ? dateKey(new Date(year, number - 1, day)) : "";
    return { key: key || `blank-${index}`, date: key, day: key ? String(day) : "", count: counts.get(key) || 0,
      selected: Boolean(key) && key === selected, today: Boolean(key) && key === dateKey(now) };
  });
}
