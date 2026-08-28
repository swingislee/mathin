"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { getTeachingCalendarRangeV2, scheduleCalendarRange } from "../academic-calendar";
import type { TeachingCalendarEntryV2 } from "../teaching-calendar";
import { authorizedClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, dateOnly, intInRange, parse, requiredText, uuid } from "./schemas";

const calendarEntrySchema = z.object({
  entryId: uuid.optional(),
  campusId: uuid.nullable(),
  name: requiredText(100),
  kind: z.enum(["closed", "teaching", "makeup"]),
  startsOn: dateOnly,
  endsOn: dateOnly,
  scheduleMode: z.enum(["mapped", "manual"]).nullable(),
  mappedWeekday: intInRange(0, 6).nullable(),
}).superRefine((value, ctx) => {
  if (value.endsOn < value.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "INVALID_HOLIDAY" });
  if (value.kind !== "closed" && value.startsOn !== value.endsOn) {
    ctx.addIssue({ code: "custom", path: ["endsOn"], message: "TEACHING_DAY_MUST_BE_SINGLE_DATE" });
  }
  if (value.kind === "closed" && (value.scheduleMode !== null || value.mappedWeekday !== null)) {
    ctx.addIssue({ code: "custom", path: ["scheduleMode"], message: "INVALID_SCHEDULE_MODE" });
  }
  if (value.kind !== "closed" && value.scheduleMode === null) {
    ctx.addIssue({ code: "custom", path: ["scheduleMode"], message: "INVALID_SCHEDULE_MODE" });
  }
  if (value.scheduleMode === "mapped" && value.mappedWeekday === null) {
    ctx.addIssue({ code: "custom", path: ["mappedWeekday"], message: "INVALID_MAPPED_WEEKDAY" });
  }
  if (value.scheduleMode === "manual" && value.mappedWeekday !== null) {
    ctx.addIssue({ code: "custom", path: ["mappedWeekday"], message: "INVALID_MAPPED_WEEKDAY" });
  }
});

const CALENDAR_CODES = [
  "INVALID_HOLIDAY",
  "INVALID_CAMPUS",
  "INVALID_SCHEDULE_MODE",
  "INVALID_MAPPED_WEEKDAY",
  "TEACHING_DAY_MUST_BE_SINGLE_DATE",
  "CALENDAR_SCOPE_OVERLAP",
  "NOT_FOUND",
  ...COMMON_CODES,
] as const;

export type TeachingCalendarEntryInput = {
  campusId: string | null;
  name: string;
  kind: "closed" | "teaching" | "makeup";
  startsOn: string;
  endsOn: string;
  scheduleMode: "mapped" | "manual" | null;
  mappedWeekday: number | null;
};

const teachingCalendarImpactSchema = z.object({
  futureSessionCount: z.number().int().nonnegative(),
  futureClassroomCount: z.number().int().nonnegative(),
  locationPendingCount: z.number().int().nonnegative(),
  historicalSessionCount: z.number().int().nonnegative(),
});

export type TeachingCalendarImpactV2 = z.infer<typeof teachingCalendarImpactSchema>;

export async function previewTeachingCalendarImpactAction(
  campusId: string | null,
  startsOn: string,
  endsOn: string,
): Promise<TeachingCalendarImpactV2> {
  const value = parse(z.object({
    campusId: uuid.nullable(),
    startsOn: dateOnly,
    endsOn: dateOnly,
  }).refine((input) => input.endsOn >= input.startsOn), { campusId, startsOn, endsOn });
  const { supabase } = await authorizedClient("schedule.manage");
  const { data, error } = await supabase.rpc("preview_teaching_calendar_impact_v2", {
    p_campus_id: nullableRpcArg(value.campusId),
    p_starts_on: value.startsOn,
    p_ends_on: value.endsOn,
  });
  if (error) throw new Error(error.message);
  return teachingCalendarImpactSchema.parse(data);
}

export async function createTeachingCalendarEntryAction(input: TeachingCalendarEntryInput): Promise<ActionResult> {
  try {
    const value = parse(calendarEntrySchema, input);
    const { supabase } = await authorizedClient("schedule.manage");
    const { error } = await supabase.rpc("create_teaching_calendar_entry_v2", {
      p_campus_id: nullableRpcArg(value.campusId),
      p_name: value.name,
      p_kind: value.kind,
      p_starts_on: value.startsOn,
      p_ends_on: value.endsOn,
      p_schedule_mode: nullableRpcArg(value.scheduleMode),
      p_mapped_weekday: nullableRpcArg(value.mappedWeekday),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, CALENDAR_CODES);
  }
}

export async function updateTeachingCalendarEntryAction(
  entryId: string,
  input: TeachingCalendarEntryInput,
): Promise<ActionResult> {
  try {
    const value = parse(calendarEntrySchema, { entryId, ...input });
    const { supabase } = await authorizedClient("schedule.manage");
    const { error } = await supabase.rpc("update_teaching_calendar_entry_v2", {
      p_entry_id: value.entryId!,
      p_campus_id: nullableRpcArg(value.campusId),
      p_name: value.name,
      p_kind: value.kind,
      p_starts_on: value.startsOn,
      p_ends_on: value.endsOn,
      p_schedule_mode: nullableRpcArg(value.scheduleMode),
      p_mapped_weekday: nullableRpcArg(value.mappedWeekday),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, CALENDAR_CODES);
  }
}

export async function archiveTeachingCalendarEntryAction(entryId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, entryId);
    const { supabase } = await authorizedClient("schedule.manage");
    const { error } = await supabase.rpc("archive_teaching_calendar_entry_v2", { p_entry_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, CALENDAR_CODES);
  }
}

export async function getClassScheduleCalendarAction(
  startDate: string,
  lectureCount: number,
): Promise<TeachingCalendarEntryV2[]> {
  const value = parse(z.object({ startDate: dateOnly, lectureCount: intInRange(1, 200) }), { startDate, lectureCount });
  await authorizedClient("class.create");
  const range = scheduleCalendarRange(value.startDate, value.lectureCount);
  return getTeachingCalendarRangeV2(range.from, range.to);
}

export async function updateScheduleDefaultsAction(defaultDurationMinutes: number): Promise<ActionResult> {
  try {
    const value = parse(intInRange(15, 300), defaultDurationMinutes);
    const { supabase } = await authorizedClient("schedule.manage");
    const { error } = await supabase.rpc("update_schedule_defaults_v2", { p_default_duration_minutes: value });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}
