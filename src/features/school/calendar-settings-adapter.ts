import { newId } from "@/lib/uuid";
import type { CalendarSchoolWindow } from "./calendar-contract";

export interface CalendarSchoolWindowDraft {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export function calendarWindowTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function calendarWindowMinute(value: string, allowEndOfDay = false): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 24 || (hour === 24 && (!allowEndOfDay || minute !== 0))) return null;
  return hour * 60 + minute;
}

export function calendarWindowDrafts(windows: readonly CalendarSchoolWindow[]): CalendarSchoolWindowDraft[] {
  return windows.map(window => ({
    id: newId(),
    weekday: window.weekday,
    startTime: calendarWindowTime(window.startMinute),
    endTime: calendarWindowTime(window.endMinute),
  }));
}

type WindowResult =
  | { ok: true; windows: CalendarSchoolWindow[] }
  | { ok: false; error: "invalidSchoolWindow" | "overlappingSchoolWindows" };

export function calendarWindowsFromDrafts(drafts: readonly CalendarSchoolWindowDraft[]): WindowResult {
  const windows: CalendarSchoolWindow[] = [];
  for (const draft of drafts) {
    const startMinute = calendarWindowMinute(draft.startTime);
    const endMinute = calendarWindowMinute(draft.endTime, true);
    if (!Number.isInteger(draft.weekday) || draft.weekday < 0 || draft.weekday > 6
      || startMinute === null || endMinute === null || endMinute <= startMinute) {
      return { ok: false, error: "invalidSchoolWindow" };
    }
    windows.push({ weekday: draft.weekday, startMinute, endMinute });
  }
  windows.sort((left, right) => left.weekday - right.weekday || left.startMinute - right.startMinute || left.endMinute - right.endMinute);
  for (let index = 1; index < windows.length; index++) {
    const previous = windows[index - 1]!;
    const current = windows[index]!;
    if (previous.weekday === current.weekday && current.startMinute < previous.endMinute) {
      return { ok: false, error: "overlappingSchoolWindows" };
    }
  }
  return { ok: true, windows };
}
