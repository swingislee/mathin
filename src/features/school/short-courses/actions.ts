"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "../actions/guards";
import { getClassBuildConflictsAction } from "../actions/classes";
import { getClassScheduleCalendarAction } from "../actions/academic-calendar";
import { getOrganizationTimezoneV2, listActiveRoomOptionsV2 } from "../organization-locations";
import { shortCourseDraftSchema, SHORT_COURSES_HREF, type ShortCourseDraft, type ShortCoursePreview } from "./contract";
import { generateShortCourseSessions, shortCourseInternalConflicts } from "./schedule";
import { shortCourseMessages } from "./messages";
import { shortCourseRpc } from "./data";

const CODES = ["UNAUTHENTICATED", "FORBIDDEN_SCOPE", "FORBIDDEN", "REQUEST_ALREADY_SAVED", "INVALID_STAFF", "INVALID_ROOM",
  "INVALID_CLASSROOM_TERM", "CLOSED_DAY_CONFIRMATION_REQUIRED", "SCHEDULE_RANGE_EXHAUSTED", "VALIDATION", "PREVIEW_CHANGED", "SCHEDULE_CONFLICT"] as const;

async function prepare(input: ShortCourseDraft, locale: string): Promise<ShortCoursePreview> {
  await authorizedClient("class.create");
  const parsed = shortCourseDraftSchema.safeParse(input);
  if (!parsed.success) throw new Error("VALIDATION");
  const draft = parsed.data;
  const [calendar, rooms, timeZone] = await Promise.all([
    getClassScheduleCalendarAction(draft.startsOn, draft.sessionCount), listActiveRoomOptionsV2(), getOrganizationTimezoneV2(),
  ]);
  const m = shortCourseMessages(locale);
  const classes = draft.classes.map(row => {
    if (row.roomId && !rooms.some(room => room.id === row.roomId)) throw new Error("INVALID_ROOM");
    return { ...row, sessions: generateShortCourseSessions({ startsOn: draft.startsOn, count: draft.sessionCount, durationMin: draft.durationMin,
      slots: row.weeklySlots, timeZone, entries: calendar, campusId: rooms.find(room => room.id === row.roomId)?.campusId ?? null, lessonName: m.lesson }) };
  });
  const conflicts = shortCourseInternalConflicts(classes, draft.durationMin);
  for (let offset = 0; offset < classes.length; offset += 4) {
    const found = await Promise.all(classes.slice(offset, offset + 4).map(async row => {
      const existing = await getClassBuildConflictsAction(row.teacherId, row.roomId, row.sessions.map(session => ({ scheduledAt: session.scheduledAt, durationMin: draft.durationMin })));
      return existing.map(conflict => ({ classKey: row.key, otherName: conflict.classroomName, scheduledAt: conflict.scheduledAt,
        teacher: conflict.teacherConflict, room: conflict.roomConflict }));
    }));
    conflicts.push(...found.flat());
  }
  conflicts.sort((a, b) => `${a.classKey}:${a.scheduledAt}:${a.otherName}`.localeCompare(`${b.classKey}:${b.scheduledAt}:${b.otherName}`));
  return { classes, conflicts, scheduleKey: JSON.stringify({ classes, conflicts }) };
}

export async function previewShortCourseBatchAction(input: ShortCourseDraft, locale: string): Promise<ActionResult<ShortCoursePreview>> {
  try { return { ok: true, data: await prepare(input, locale) }; }
  catch (error) { return actionError(error, CODES); }
}

export async function createShortCourseBatchAction(input: ShortCourseDraft, locale: string, scheduleKey: string): Promise<ActionResult<{ batchId: string; classroomIds: string[] }>> {
  try {
    await authorizedClient("class.create");
    const draft = shortCourseDraftSchema.safeParse(input);
    if (!draft.success) throw new Error("VALIDATION");
    const resultSchema = z.object({ batchId: z.string().uuid(), classroomIds: z.array(z.string().uuid()) });
    const receipt = await shortCourseRpc("get_short_course_batch_receipt", { p_input: draft.data });
    if (receipt) return { ok: true, data: resultSchema.parse(receipt) };
    const preview = await prepare(draft.data, locale);
    if (preview.scheduleKey !== scheduleKey) throw new Error("PREVIEW_CHANGED");
    if (preview.conflicts.length) throw new Error("SCHEDULE_CONFLICT");
    const result = resultSchema.parse(
      await shortCourseRpc("create_short_course_batch", { p_input: { ...draft.data, classes: preview.classes } }),
    );
    revalidatePath(SHORT_COURSES_HREF, "page");
    revalidatePath("/dashboard/schedule", "page");
    return { ok: true, data: result };
  } catch (error) { return actionError(error, CODES); }
}
