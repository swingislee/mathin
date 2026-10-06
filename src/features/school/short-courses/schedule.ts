import { zonedDateTimeToInstant } from "../schedule";
import { effectiveTeachingCalendarEntry, type TeachingCalendarEntryV2 } from "../teaching-calendar";
import type { ShortCourseDraft, ShortCoursePlannedLesson, ShortCoursePreview, WeeklySlot } from "./contract";

/** Each weekday has its own clock time; mapped teaching days inherit that slot. */
export function generateShortCourseSessions(input: {
  startsOn: string; count: number; durationMin: number; slots: readonly WeeklySlot[];
  timeZone: string; entries: readonly TeachingCalendarEntryV2[]; campusId: string | null;
  lessonName: (index: number) => string;
}): ShortCoursePlannedLesson[] {
  const cursor = new Date(`${input.startsOn}T00:00:00Z`);
  if (!Number.isFinite(cursor.getTime()) || !input.slots.length) return [];
  const sessions: ShortCoursePlannedLesson[] = [];
  const end = input.count * 14 + 60;
  for (let step = 0; sessions.length < input.count && step < end; step += 1) {
    const day = cursor.toISOString().slice(0, 10);
    const entry = effectiveTeachingCalendarEntry(input.entries, day, input.campusId);
    if (entry?.kind !== "closed" && entry?.scheduleMode !== "manual") {
      const weekday = entry?.scheduleMode === "mapped" ? entry.mappedWeekday : cursor.getUTCDay();
      const slot = input.slots.find(value => value.weekday === weekday);
      if (slot) {
        const [hour, minute] = slot.time.split(":").map(Number);
        const scheduled = zonedDateTimeToInstant({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth(),
          day: cursor.getUTCDate(), hour, minute }, input.timeZone);
        sessions.push({ name: input.lessonName(sessions.length + 1), scheduledAt: scheduled.toISOString() });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (sessions.length !== input.count) throw new Error("SCHEDULE_RANGE_EXHAUSTED");
  return sessions;
}

export function shortCourseInternalConflicts(classes: ShortCoursePreview["classes"], durationMin: number): ShortCoursePreview["conflicts"] {
  const conflicts: ShortCoursePreview["conflicts"] = [];
  for (let i = 0; i < classes.length; i += 1) {
    for (let j = i + 1; j < classes.length; j += 1) {
      const left = classes[i], right = classes[j];
      const teacher = left.teacherId === right.teacherId;
      const room = left.roomId !== null && left.roomId === right.roomId;
      if (!teacher && !room) continue;
      for (const a of left.sessions) for (const b of right.sessions) {
        if (Math.abs(Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt)) < durationMin * 60000) {
          conflicts.push({ classKey: left.key, otherName: right.name, scheduledAt: a.scheduledAt, teacher, room });
        }
      }
    }
  }
  return conflicts;
}

/** Exact preview signature: editing any saved fact invalidates an old preview. */
export function shortCourseDraftKey(draft: ShortCourseDraft) { return JSON.stringify(draft); }
