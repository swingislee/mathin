"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { getMyPerms } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parse, uuid } from "./actions/schemas";
import { calendarRecurrenceSchema, calendarRecurrenceWithinRange } from "./calendar-recurrence-schema";
import {
  type AssessmentAvailabilitySlot,
  type AssessmentSlotManagement,
  type SaveAssessmentSlotInput,
} from "./assessment-availability-contract";

const ERROR_CODES = ["UNAUTHENTICATED", "FORBIDDEN", "VALIDATION", "NOT_FOUND", "CONFLICT", "SLOT_BOOKED", "TIME_UNAVAILABLE", "NO_ELIGIBLE_TEACHER", "CAMPUS_UNAVAILABLE", "RULE_MANAGED"] as const;
const instant = z.string().datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const subjects = z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)).min(1).max(12).refine(value => new Set(value).size === value.length);
const grades = z.array(z.number().int().min(-1).max(12)).max(14).refine(value => new Set(value).size === value.length);
const slotSchema = z.object({
  ruleId: uuid.nullable().optional(), id: uuid, teacherId: uuid, campusId: uuid, mode: z.enum(["campus", "online"]).optional(), joiningInstructions: z.string().max(2000).optional(), subjects, grades,
  startsAt: instant, endsAt: instant, enabled: z.boolean(), booked: z.boolean(), activeBooked: z.boolean().optional(), blocked: z.boolean().optional(), updatedAt: instant,
});
const managementSchema = z.object({
  topics: z.array(z.object({ id: z.string(), name: z.string(), nameEn: z.string(), enabled: z.boolean(), updatedAt: instant })).default([]),
  currentUserId: uuid, canManageAll: z.boolean(),
  teachers: z.array(z.object({ id: uuid, displayName: z.string() })),
  campuses: z.array(z.object({ id: uuid, name: z.string() })),
  slots: z.array(slotSchema),
});
const saveSchema = z.object({
  slotId: uuid, teacherId: uuid, campusId: uuid, mode: z.enum(["campus", "online"]).default("campus"), joiningInstructions: z.string().max(2000).default(""), subjects, grades,
  startsAt: instant, endsAt: instant, enabled: z.boolean(), expectedUpdatedAt: instant.nullable(),
  recurrence: calendarRecurrenceSchema.nullable().optional(),
}).refine(value => {
  const duration = (Date.parse(value.endsAt) - Date.parse(value.startsAt)) / 60_000;
  return duration >= 5 && duration <= 240 && Number.isInteger(duration)
    && Date.parse(value.startsAt) % 60_000 === 0
    && calendarRecurrenceWithinRange(value.startsAt, value.recurrence)
    && (!value.recurrence || value.expectedUpdatedAt === null);
});

async function authorizedClient() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const permissions = await getMyPerms(user.id);
  if (!permissions.has("review.write") && !permissions.has("followup.write") && !permissions.has("schedule.manage")) throw new Error("FORBIDDEN");
  return client;
}

export async function loadAssessmentSlotManagementAction(input: { from: string; to: string }): Promise<ActionResult<AssessmentSlotManagement>> {
  try {
    const range = parse(z.object({ from: day, to: day }).refine(value => {
      const days = (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000;
      return days >= 0 && days < 93;
    }), input);
    const client = await authorizedClient();
    const result = await client.rpc("get_assessment_slot_management", { p_from: range.from, p_to: range.to });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: managementSchema.parse(result.data) };
  } catch (error) {
    return actionError(error, ERROR_CODES);
  }
}

export async function saveAssessmentSlotAction(input: SaveAssessmentSlotInput): Promise<ActionResult<AssessmentAvailabilitySlot>> {
  try {
    const value = parse(saveSchema, input);
    const client = await authorizedClient();
    const args = {
      p_slot_id: value.slotId, p_teacher_id: value.teacherId, p_campus_id: value.campusId,
      p_subjects: value.subjects, p_grades: value.grades, p_starts_at: value.startsAt, p_ends_at: value.endsAt,
      p_enabled: value.enabled, p_mode: value.mode, p_joining_instructions: value.joiningInstructions, p_expected_updated_at: value.expectedUpdatedAt ?? undefined,
    };
    const result = value.recurrence
      ? await client.rpc("save_assessment_slot_series_v2", { ...args, p_recurrence: value.recurrence })
      : await client.rpc("save_assessment_slot_v2", args);
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: slotSchema.parse(result.data) };
  } catch (error) {
    return actionError(error, ERROR_CODES);
  }
}
