import { newId } from "@/lib/uuid";
import type { AssessmentSlotDraft, AssessmentSlotSubject } from "./assessment-availability-contract";
import type { CalendarEventKind } from "./calendar-contract";
import { calendarRange } from "./calendar-layout";
import { calendarDayKey, dateTimeInputToInstant, zonedDateTimeInputValue } from "./schedule";

export interface CalendarCreateDraft {
  id: string;
  kind: CalendarEventKind | "availability";
  title: string;
  description: string;
  start: string;
  end: string;
  location: string;
  campusId: string;
  attendeeIds: string[];
  teacherId: string;
  subjects: AssessmentSlotSubject[];
}

export function newCalendarCreateDraft(kind: CalendarCreateDraft["kind"], at: Date, timeZone: string): CalendarCreateDraft {
  const year = calendarRange(calendarDayKey(at, timeZone), "year", timeZone);
  return {
    id: newId(), kind, title: "", description: "", location: "", campusId: "", attendeeIds: [], teacherId: "", subjects: ["math"],
    start: zonedDateTimeInputValue(kind === "strategy" ? year.start : at, timeZone),
    end: zonedDateTimeInputValue(kind === "strategy" ? year.end : new Date(at.getTime() + 30 * 60_000), timeZone),
  };
}

export function calendarCreateSlotDraft(draft: CalendarCreateDraft): AssessmentSlotDraft {
  return {
    slotId: draft.id, teacherId: draft.teacherId, campusId: draft.campusId, subjects: draft.subjects, grades: [],
    date: draft.start.slice(0, 10), endDate: draft.end.slice(0, 10), startTime: draft.start.slice(11), endTime: draft.end.slice(11),
    enabled: true, expectedUpdatedAt: null,
  };
}

export function calendarCreatePreview(draft: CalendarCreateDraft, timeZone: string) {
  const start = dateTimeInputToInstant(draft.start, timeZone);
  const end = draft.kind === "milestone" && start ? new Date(start.getTime() + 30 * 60_000) : dateTimeInputToInstant(draft.end, timeZone);
  return start && end && end > start ? {
    id: draft.id, sourceId: draft.id, kind: draft.kind, title: draft.title,
    startsAt: start.toISOString(), endsAt: end.toISOString(),
  } : null;
}
