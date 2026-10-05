import { addCalendarDays, calendarDayKey, dateTimeInputToInstant, zonedDateTimeInputValue } from "./schedule";

export const ASSESSMENT_SLOT_SUBJECTS = ["math", "english"] as const;
export type AssessmentSlotSubject = typeof ASSESSMENT_SLOT_SUBJECTS[number];
export const ASSESSMENT_SLOT_GRADES = Array.from({ length: 14 }, (_, index) => index - 1);

export interface AssessmentAvailabilitySlot {
  id: string;
  teacherId: string;
  campusId: string;
  subjects: AssessmentSlotSubject[];
  grades: number[];
  startsAt: string;
  endsAt: string;
  enabled: boolean;
  booked: boolean;
  activeBooked?: boolean;
  blocked?: boolean;
  updatedAt: string;
}

export interface AssessmentSlotManagement {
  currentUserId: string;
  canManageAll: boolean;
  teachers: { id: string; displayName: string }[];
  campuses: { id: string; name: string }[];
  slots: AssessmentAvailabilitySlot[];
}

export interface AssessmentSlotDraft {
  slotId: string;
  teacherId: string;
  campusId: string;
  subjects: AssessmentSlotSubject[];
  grades: number[];
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
  expectedUpdatedAt: string | null;
}

export interface SaveAssessmentSlotInput {
  slotId: string;
  teacherId: string;
  campusId: string;
  subjects: AssessmentSlotSubject[];
  grades: number[];
  startsAt: string;
  endsAt: string;
  enabled: boolean;
  expectedUpdatedAt: string | null;
}

export function assessmentSlotDraft(slot: AssessmentAvailabilitySlot, timeZone: string): AssessmentSlotDraft {
  const start = zonedDateTimeInputValue(new Date(slot.startsAt), timeZone);
  return {
    slotId: slot.id, teacherId: slot.teacherId, campusId: slot.campusId,
    subjects: [...slot.subjects], grades: [...slot.grades], date: start.slice(0, 10), startTime: start.slice(11),
    endDate: calendarDayKey(new Date(slot.endsAt), timeZone),
    endTime: zonedDateTimeInputValue(new Date(slot.endsAt), timeZone).slice(11),
    enabled: slot.enabled, expectedUpdatedAt: slot.updatedAt,
  };
}

export function assessmentSlotInput(draft: AssessmentSlotDraft, timeZone: string): SaveAssessmentSlotInput | null {
  const startsAt = dateTimeInputToInstant(`${draft.date}T${draft.startTime}`, timeZone);
  const endsAt = dateTimeInputToInstant(`${draft.endDate ?? draft.date}T${draft.endTime}`, timeZone);
  if (!startsAt || !endsAt || endsAt <= startsAt || !draft.teacherId || !draft.campusId || draft.subjects.length === 0) return null;
  const duration = (endsAt.getTime() - startsAt.getTime()) / 60_000;
  if (duration < 5 || duration > 240) return null;
  return {
    slotId: draft.slotId, teacherId: draft.teacherId, campusId: draft.campusId,
    subjects: [...draft.subjects], grades: [...draft.grades],
    startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
    enabled: draft.enabled, expectedUpdatedAt: draft.expectedUpdatedAt,
  };
}

export function shiftAssessmentSlotDate(value: string, days: number, timeZone: string): string {
  const instant = dateTimeInputToInstant(`${value}T12:00`, timeZone);
  if (!instant) return value;
  return calendarDayKey(addCalendarDays(instant, days, timeZone), timeZone);
}

export function assessmentAvailabilityError(code: string): string {
  if (code === "UNAUTHENTICATED" || code === "FORBIDDEN") return "forbidden";
  if (code === "VALIDATION") return "invalid";
  if (code === "CONFLICT") return "conflict";
  if (code === "SLOT_BOOKED") return "bookedConflict";
  if (code === "TIME_UNAVAILABLE") return "timeUnavailable";
  if (code === "NO_ELIGIBLE_TEACHER") return "teacherUnavailable";
  if (code === "CAMPUS_UNAVAILABLE") return "campusUnavailable";
  if (code === "NOT_FOUND") return "notFound";
  return "failed";
}
