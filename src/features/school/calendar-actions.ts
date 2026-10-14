"use server";

import { getAuthUser } from "@/lib/auth";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { parse, uuid } from "./actions/schemas";
import { CALENDAR_EVENT_KINDS, type CalendarEvent, type CalendarEventStatus, type CalendarSchoolWindow, type CalendarSchoolWindowsSettings, type CalendarWorkspace, type SaveCalendarEventInput } from "./calendar-contract";
import { calendarRecurrenceSchema, calendarRecurrenceWithinRange } from "./calendar-recurrence-schema";

const ERROR_CODES = ["UNAUTHENTICATED", "FORBIDDEN", "VALIDATION", "NOT_FOUND", "CONFLICT", "TIME_UNAVAILABLE", "ATTENDEE_UNAVAILABLE", "CAMPUS_UNAVAILABLE", "EVENT_CLOSED"] as const;
const instant = z.string().datetime({ offset: true });
const status = z.enum(["scheduled", "completed", "cancelled"]);
const eventSchema = z.object({
  id: uuid, kind: z.enum(CALENDAR_EVENT_KINDS), title: z.string(), description: z.string(),
  startsAt: instant, endsAt: instant, location: z.string(), campusId: uuid.nullable(), status,
  organizerId: uuid, organizerName: z.string(),
  attendees: z.array(z.object({ userId: uuid, displayName: z.string(), response: z.enum(["pending", "accepted", "declined"]), completedAt: instant.nullable() })),
  updatedAt: instant, canEdit: z.boolean(), canComplete: z.boolean(), myCompletedAt: instant.nullable(),
  seriesId: uuid.nullable(), recurrence: calendarRecurrenceSchema.nullable(),
});
const schoolWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440),
}).refine(value => value.endMinute > value.startMinute);
const schoolWindowsSchema = z.array(schoolWindowSchema).max(70).refine(value => !value.some((left, index) =>
  value.slice(index + 1).some(right => left.weekday === right.weekday
    && left.startMinute < right.endMinute && right.startMinute < left.endMinute)));
const schoolSettingsSchema = z.object({ schoolWindows: schoolWindowsSchema, availableWindows: schoolWindowsSchema, updatedAt: instant });
const workspaceSchema = z.object({
  currentUserId: uuid, people: z.array(z.object({ id: uuid, displayName: z.string() })),
  events: z.array(eventSchema), canCreate: z.boolean(),
  schoolWindows: schoolWindowsSchema, availableWindows: schoolWindowsSchema.default([]), settingsUpdatedAt: instant.nullable(), canManageSettings: z.boolean(),
  teachingCalendar: z.array(z.object({
    id: uuid, campusId: uuid.nullable(), campusName: z.string().nullable(), name: z.string(),
    kind: z.enum(["closed", "teaching", "makeup"]), startsOn: z.string(), endsOn: z.string(),
    scheduleMode: z.enum(["mapped", "manual"]).nullable(), mappedWeekday: z.number().int().min(0).max(6).nullable(), createdAt: z.string(),
  })),
});
const saveSchema = z.object({
  id: uuid, kind: z.enum(CALENDAR_EVENT_KINDS), title: z.string().trim().min(1).max(160),
  description: z.string().max(8000), startsAt: instant, endsAt: instant,
  location: z.string().trim().max(300), campusId: uuid.nullable(),
  attendeeIds: z.array(uuid).max(100).refine(value => new Set(value).size === value.length),
  expectedUpdatedAt: instant.nullable(),
  recurrence: calendarRecurrenceSchema.nullable().optional(),
}).refine(value => {
  const duration = Date.parse(value.endsAt) - Date.parse(value.startsAt);
  return duration > 0 && duration <= (value.kind === "strategy" ? 370 : 31) * 86_400_000
    && (value.kind !== "milestone" || duration === 30 * 60_000)
    && calendarRecurrenceWithinRange(value.startsAt, value.recurrence)
    && (!value.recurrence || value.expectedUpdatedAt === null);
});

async function authenticatedClient() {
  const client = await createClient();
  const user = await getAuthUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return client;
}

export async function loadCalendarWorkspaceAction(input: { from: string; to: string }): Promise<ActionResult<CalendarWorkspace>> {
  try {
    const range = parse(z.object({ from: instant, to: instant }).refine(value => {
      const duration = Date.parse(value.to) - Date.parse(value.from);
      return duration > 0 && duration <= 370 * 86_400_000;
    }), input);
    const client = await authenticatedClient();
    const result = await client.rpc("get_calendar_workspace", { p_from: range.from, p_to: range.to });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: workspaceSchema.parse(result.data) };
  } catch (error) { return actionError(error, ERROR_CODES); }
}

export async function saveCalendarEventAction(input: SaveCalendarEventInput): Promise<ActionResult<CalendarEvent>> {
  try {
    const value = parse(saveSchema, input);
    const client = await authenticatedClient();
    const result = await client.rpc("save_calendar_event", {
      p_id: value.id, p_kind: value.kind, p_title: value.title, p_description: value.description,
      p_starts_at: value.startsAt, p_ends_at: value.endsAt, p_location: value.location,
      p_campus_id: value.campusId ?? undefined, p_attendee_ids: value.attendeeIds,
      p_expected_updated_at: value.expectedUpdatedAt ?? undefined,
      p_recurrence: value.recurrence ?? undefined,
    });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: eventSchema.parse(result.data) };
  } catch (error) { return actionError(error, ERROR_CODES); }
}

export async function saveCalendarSchoolWindowsAction(input: { schoolWindows: CalendarSchoolWindow[]; availableWindows: CalendarSchoolWindow[]; expectedUpdatedAt: string | null }): Promise<ActionResult<CalendarSchoolWindowsSettings>> {
  try {
    const value = parse(z.object({ schoolWindows: schoolWindowsSchema, availableWindows: schoolWindowsSchema, expectedUpdatedAt: instant.nullable() }), input);
    const client = await authenticatedClient();
    const result = await client.rpc("save_calendar_scheduling_settings", {
      p_school_windows: value.schoolWindows, p_available_windows: value.availableWindows, p_expected_updated_at: value.expectedUpdatedAt ?? undefined,
    });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: schoolSettingsSchema.parse(result.data) };
  } catch (error) { return actionError(error, ERROR_CODES); }
}

export async function loadCalendarSeriesAction(seriesId: string): Promise<ActionResult<CalendarEvent[]>> {
  try {
    const id = parse(uuid, seriesId);
    const client = await authenticatedClient();
    const result = await client.rpc("get_calendar_series", { p_series_id: id });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: z.array(eventSchema).parse(result.data) };
  } catch (error) { return actionError(error, ERROR_CODES); }
}

export async function changeCalendarEventStatusAction(input: { id: string; status: CalendarEventStatus; expectedUpdatedAt: string }): Promise<ActionResult<CalendarEvent>> {
  try {
    const value = parse(z.object({ id: uuid, status, expectedUpdatedAt: instant }), input);
    const client = await authenticatedClient();
    const result = await client.rpc("change_calendar_event_status", { p_id: value.id, p_status: value.status, p_expected_updated_at: value.expectedUpdatedAt });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: eventSchema.parse(result.data) };
  } catch (error) { return actionError(error, ERROR_CODES); }
}

export async function respondCalendarInvitationAction(input: { id: string; response: "accepted" | "declined" }): Promise<ActionResult<CalendarEvent>> {
  try {
    const value = parse(z.object({ id: uuid, response: z.enum(["accepted", "declined"]) }), input);
    const client = await authenticatedClient();
    const result = await client.rpc("respond_calendar_invitation", { p_id: value.id, p_response: value.response });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: eventSchema.parse(result.data) };
  } catch (error) { return actionError(error, ERROR_CODES); }
}
