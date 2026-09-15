import { addCalendarDays, calendarDayKey, dateTimeInputToInstant } from "../schedule";
import { teachingPeriodWindow } from "./teaching-workbench-contract";

export type TeachingTimeGrain = "week" | "month" | "term";
export type TeachingTerm = { id: string; year: number; term: number; startsOn: string | null; endsOn: string | null; isCurrent: boolean };
export type TeachingTimeWindow = { start: string; end: string; date: string; lastDate: string; previous: string | null; next: string | null; current: boolean; previousSelected: boolean; termId?: string };
export const teachingTimeGrain = (value: unknown): TeachingTimeGrain => value === "month" || value === "term" ? value : "week";

export function availableTeachingTerms(terms: TeachingTerm[]) {
  return terms.filter(term => term.startsOn && term.endsOn && term.startsOn <= term.endsOn)
    .sort((a, b) => a.startsOn!.localeCompare(b.startsOn!) || a.id.localeCompare(b.id));
}

/** 学期起止来自机构设置，结束日计入范围；周一至周日按机构时区计算。 */
export function teachingTimeWindow(grain: TeachingTimeGrain, selection: string | undefined, termId: string | undefined, terms: TeachingTerm[], timeZone: string, now = new Date()): TeachingTimeWindow | null {
  if (grain !== "term") {
    const current = teachingPeriodWindow(grain, undefined, timeZone, now);
    const value = selection === "previous" ? current.previous : selection === "current" ? undefined : selection;
    const window = teachingPeriodWindow(grain, value, timeZone, now);
    return { ...window, current: window.date === current.date, previousSelected: window.date === current.previous };
  }
  const available = availableTeachingTerms(terms);
  const today = calendarDayKey(now, timeZone);
  const current = available.find(term => term.startsOn! <= today && today <= term.endsOn!) ?? available.find(term => term.isCurrent);
  const currentIndex = current ? available.indexOf(current) : -1;
  const selected = termId ? available.find(term => term.id === termId)
    : selection === "previous" ? available[currentIndex - 1]
    : selection && selection !== "current" ? available.find(term => term.startsOn! <= selection && selection <= term.endsOn!) : current;
  if (!selected) return null;
  const start = dateTimeInputToInstant(`${selected.startsOn}T00:00`, timeZone);
  const last = dateTimeInputToInstant(`${selected.endsOn}T00:00`, timeZone);
  if (!start || !last) return null;
  const index = available.indexOf(selected);
  return { start: start.toISOString(), end: addCalendarDays(last, 1, timeZone).toISOString(), date: selected.startsOn!, lastDate: selected.endsOn!,
    previous: available[index - 1]?.startsOn ?? null, next: available[index + 1]?.startsOn ?? null,
    current: selected.id === current?.id, previousSelected: index === currentIndex - 1, termId: selected.id };
}

export function teachingTimeHref(baseHref: string, grain: TeachingTimeGrain, date: string, termId?: string) {
  const [path, raw] = baseHref.split("?");
  const params = new URLSearchParams(raw);
  params.set("period", grain); params.set("date", date);
  if (termId) params.set("term", termId); else params.delete("term");
  for (const key of ["session", "contactPage", "contactSize"]) params.delete(key);
  return `${path}?${params}`;
}
