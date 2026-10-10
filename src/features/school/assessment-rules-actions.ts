"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { getMyPerms } from "@/lib/auth";
import { parse, uuid } from "./actions/schemas";
import type { AssessmentRulesWorkspace, SaveAssessmentRuleInput, AssessmentTopicDefinition, AssessmentCalendarSlot } from "./assessment-rules-contract";

const errors = ["UNAUTHENTICATED", "FORBIDDEN", "VALIDATION", "NOT_FOUND", "CONFLICT", "TIME_UNAVAILABLE", "NO_ELIGIBLE_TEACHER", "CAMPUS_UNAVAILABLE", "RULE_TOO_LARGE"];
const instant = z.string().datetime({ offset: true });
const topicId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const unique = <T,>(values: T[]) => values.length === new Set(values).size;
const definitionSchema = z.object({
  kind: z.enum(["open", "exclude"]), label: z.string().max(120), campusId: uuid.nullable(),
  topics: z.array(topicId).max(12).refine(unique), grades: z.array(z.number().int().min(-1).max(12)).max(14).refine(unique),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).refine(unique),
  from: z.iso.date(), until: z.iso.date(), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440),
  durationMinutes: z.number().int().min(5).max(240).nullable(), timeZone: z.string().min(1).max(100), enabled: z.boolean(),
}).strict();
const topicSchema = z.object({ id: topicId, name: z.string().min(1).max(80), nameEn: z.string().max(80), enabled: z.boolean(), updatedAt: instant });
const scopeSchema = z.object({ kind: z.enum(["all", "groups", "teachers"]), ids: z.array(uuid).max(500).refine(unique) }).strict()
  .refine(scope => scope.kind === "all" ? scope.ids.length === 0 : scope.ids.length > 0);
const workspaceSchema = z.object({
  currentUserId: uuid, canManageAll: z.boolean(), canManageStaff: z.boolean(),
  teachers: z.array(z.object({ id: uuid, displayName: z.string(), canReceive: z.boolean(), standaloneCount: z.number().int().nonnegative(), groupIds: z.array(uuid) })),
  groups: z.array(z.object({ id: uuid, name: z.string() })),
  campuses: z.array(z.object({ id: uuid, name: z.string(), active: z.boolean() })), topics: z.array(topicSchema),
  rules: z.array(definitionSchema.extend({ id: uuid, teacherId: uuid.nullable(), scope: scopeSchema.nullable(), updatedAt: instant,
    availableCount: z.number().int().nonnegative(), bookedCount: z.number().int().nonnegative() })),
});

async function authorizedClient() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const perms = await getMyPerms(user.id);
  if (!perms.has("review.write") && !perms.has("followup.write") && !perms.has("schedule.manage")) throw new Error("FORBIDDEN");
  return client;
}

export async function loadAssessmentRulesAction(): Promise<ActionResult<AssessmentRulesWorkspace>> {
  try {
    const client = await authorizedClient();
    const result = await client.rpc("get_assessment_rules_workspace");
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: workspaceSchema.parse(result.data) };
  } catch (error) { return actionError(error, errors); }
}

export async function saveAssessmentRuleAction(input: SaveAssessmentRuleInput): Promise<ActionResult<AssessmentRulesWorkspace>> {
  try {
    const value = parse(z.object({ id: uuid, teacherId: uuid.nullable(), scope: scopeSchema.nullable().optional(), definition: definitionSchema, expectedUpdatedAt: instant.nullable() }).strict()
      .refine(value => value.teacherId ? !value.scope : Boolean(value.scope)).refine(({ definition: d }) => {
      const days = (Date.parse(d.until) - Date.parse(d.from)) / 86400000;
      return days >= 0 && days <= 370 && d.endMinute > d.startMinute && (d.kind === "open"
        ? Boolean(d.campusId && d.topics.length && d.weekdays.length && d.durationMinutes && d.durationMinutes <= d.endMinute - d.startMinute)
        : d.topics.length === 0 && d.grades.length === 0 && d.durationMinutes === null);
    }), input);
    const client = await authorizedClient();
    const result = value.teacherId
      ? await client.rpc("save_assessment_rule", { p_id: value.id, p_teacher_id: value.teacherId,
        p_definition: value.definition, p_expected_updated_at: value.expectedUpdatedAt ?? undefined })
      : await client.rpc("save_assessment_shared_rule", { p_id: value.id, p_scope: value.scope!,
        p_definition: value.definition, p_expected_updated_at: value.expectedUpdatedAt ?? undefined });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: workspaceSchema.parse(result.data) };
  } catch (error) { return actionError(error, errors); }
}

export async function loadAssessmentTeacherCalendarAction(input: { teacherId: string; from: string; to: string }): Promise<ActionResult<AssessmentCalendarSlot[]>> {
  try {
    const value = parse(z.object({ teacherId: uuid, from: z.iso.date(), to: z.iso.date() }).strict()
      .refine(value => { const days = (Date.parse(value.to) - Date.parse(value.from)) / 86400000; return days >= 0 && days <= 30; }), input);
    const client = await authorizedClient();
    const result = await client.rpc("get_assessment_teacher_calendar", { p_teacher_id: value.teacherId, p_from: value.from, p_to: value.to });
    if (result.error) throw new Error(result.error.message);
    const schema = z.array(z.object({ id: uuid, campusId: uuid, subjects: z.array(topicId), startsAt: instant, endsAt: instant,
      enabled: z.boolean(), activeBooked: z.boolean(), blocked: z.boolean() }));
    return { ok: true, data: schema.parse(result.data) };
  } catch (error) { return actionError(error, errors); }
}

export async function saveAssessmentTopicAction(input: Omit<AssessmentTopicDefinition, "updatedAt"> & { expectedUpdatedAt: string | null }): Promise<ActionResult<AssessmentRulesWorkspace>> {
  try {
    const value = parse(topicSchema.omit({ updatedAt: true }).extend({ expectedUpdatedAt: instant.nullable() }).strict(), input);
    const client = await authorizedClient();
    const result = await client.rpc("save_assessment_topic", { p_id: value.id, p_name: value.name, p_name_en: value.nameEn,
      p_enabled: value.enabled, p_expected_updated_at: value.expectedUpdatedAt ?? undefined });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: workspaceSchema.parse(result.data) };
  } catch (error) { return actionError(error, errors); }
}
