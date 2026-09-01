"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { getMyPerms } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  ASSESSMENT_LEVELS,
  OPPORTUNITY_STAGES,
  type AssessmentLevel,
  type OpportunityStage,
} from "./activity-funnel-contract";
import { ACTIVITY_KINDS, type ActivityKind } from "./activity-kinds";
import { COMMON_CODES, datetime, intInRange, parse, requiredText, searchQuery, text, uuid } from "./actions/schemas";
import type { PermissionKey } from "./permissions";

const activityInputSchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  title: requiredText(100),
  scheduledAt: datetime,
  durationMin: intInRange(1, 32_767).nullable(),
  location: text(100),
  capacity: intInRange(1, 32_767).nullable(),
  remark: text(1_000),
});

const activityResultSchema = z.object({
  id: uuid,
  status: z.enum(["attended", "no_show", "cancelled"]),
  outcome: text(1_000),
});

const activityAssessmentSchema = z.object({
  registrationId: uuid,
  overallLevel: z.enum(ASSESSMENT_LEVELS),
  score: intInRange(0, 100).nullable(),
  strengths: text(2_000),
  focusAreas: text(2_000),
  teacherRecommendation: requiredText(2_000),
});

const opportunityCreateSchema = z.object({
  registrationId: uuid,
  ownerId: uuid,
  nextAction: requiredText(500),
  nextActionAt: datetime,
  note: text(2_000),
});

const opportunityUpdateSchema = z.object({
  opportunityId: uuid,
  stage: z.enum(OPPORTUNITY_STAGES),
  ownerId: uuid,
  nextAction: text(500),
  nextActionAt: datetime.nullable(),
  note: text(2_000),
}).superRefine((value, context) => {
  if (!(["won", "lost"] as OpportunityStage[]).includes(value.stage)) {
    if (!value.nextAction || !value.nextActionAt) {
      context.addIssue({ code: "custom", message: "OPEN_OPPORTUNITY_REQUIRES_NEXT_ACTION" });
    }
  }
});

export interface ActivityInput {
  kind: ActivityKind;
  title: string;
  scheduledAt: string;
  durationMin: number | null;
  location: string;
  capacity: number | null;
  remark: string;
}

export interface ActivityAssessmentInput {
  registrationId: string;
  overallLevel: AssessmentLevel;
  score: number | null;
  strengths: string;
  focusAreas: string;
  teacherRecommendation: string;
}

export interface ActivityOpportunityCreateInput {
  registrationId: string;
  ownerId: string;
  nextAction: string;
  nextActionAt: string;
  note: string;
}

export interface ActivityOpportunityUpdateInput {
  opportunityId: string;
  stage: OpportunityStage;
  ownerId: string;
  nextAction: string;
  nextActionAt: string | null;
  note: string;
}

type UntypedRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return (supabase.rpc as UntypedRpc).bind(supabase);
}

async function authorizedActivityClient(key: PermissionKey) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  if (!(await getMyPerms(user.id)).has(key)) throw new Error("FORBIDDEN");
  return supabase;
}

async function authorizedActivityClientAny(keys: readonly PermissionKey[]) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const permissions = await getMyPerms(user.id);
  if (!keys.some((key) => permissions.has(key))) throw new Error("FORBIDDEN");
  return supabase;
}

function activityRpcArgs(input: ActivityInput) {
  const value = parse(activityInputSchema, input);
  return {
    p_kind: value.kind,
    p_title: value.title,
    p_scheduled_at: value.scheduledAt,
    p_duration_min: value.durationMin ?? undefined,
    p_location: value.location,
    p_capacity: value.capacity ?? undefined,
    p_remark: value.remark,
  };
}

const ACTIVITY_ERROR_CODES = [
  "INVALID_INPUT",
  "INVALID_KIND",
  "EMPTY_TITLE",
  "NOT_FOUND",
  "ACTIVITY_FULL",
  "INVALID_ASSESSMENT",
  "INVALID_OPPORTUNITY",
  "INVALID_OWNER",
  "PARTICIPATION_NOT_ATTENDED",
  "ASSESSMENT_REQUIRED",
  ...COMMON_CODES,
];

export async function createActivityAction(input: ActivityInput): Promise<ActionResult> {
  try {
    const supabase = await authorizedActivityClient("activity.manage");
    const { error } = await supabase.rpc("create_activity", activityRpcArgs(input));
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTIVITY_ERROR_CODES);
  }
}

export async function updateActivityAction(id: string, input: ActivityInput): Promise<ActionResult> {
  try {
    const value = parse(uuid, id);
    const supabase = await authorizedActivityClient("activity.manage");
    const { error } = await supabase.rpc("update_activity", {
      p_activity_id: value,
      ...activityRpcArgs(input),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTIVITY_ERROR_CODES);
  }
}

export async function deleteActivityAction(id: string): Promise<ActionResult> {
  try {
    const value = parse(uuid, id);
    const supabase = await authorizedActivityClient("activity.manage");
    const { error } = await supabase.rpc("delete_activity", { p_activity_id: value });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTIVITY_ERROR_CODES);
  }
}

export async function bookActivityAction(activityId: string, studentId: string): Promise<ActionResult> {
  try {
    const value = parse(z.object({ activityId: uuid, studentId: uuid }), { activityId, studentId });
    const supabase = await authorizedActivityClient("activity.register");
    const { error } = await supabase.rpc("book_activity", {
      p_activity_id: value.activityId,
      p_student_id: value.studentId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTIVITY_ERROR_CODES);
  }
}

export async function markActivityResultAction(
  id: string,
  status: "attended" | "no_show" | "cancelled",
  outcome: string,
): Promise<ActionResult> {
  try {
    const value = parse(activityResultSchema, { id, status, outcome });
    const supabase = await authorizedActivityClient("activity.register");
    const { error } = await supabase.rpc("mark_activity_result", {
      p_registration_id: value.id,
      p_status: value.status,
      p_outcome: value.outcome,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTIVITY_ERROR_CODES);
  }
}

export async function saveActivityAssessmentAction(input: ActivityAssessmentInput): Promise<ActionResult> {
  try {
    const value = parse(activityAssessmentSchema, input);
    const supabase = await authorizedActivityClientAny(["activity.register", "review.write"]);
    const { error } = await rpc(supabase)("save_activity_assessment", {
      p_registration_id: value.registrationId,
      p_overall_level: value.overallLevel,
      p_score: value.score ?? undefined,
      p_strengths: value.strengths,
      p_focus_areas: value.focusAreas,
      p_teacher_recommendation: value.teacherRecommendation,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTIVITY_ERROR_CODES);
  }
}

export async function createActivityOpportunityAction(
  input: ActivityOpportunityCreateInput,
): Promise<ActionResult> {
  try {
    const value = parse(opportunityCreateSchema, input);
    const supabase = await authorizedActivityClient("followup.write");
    const { error } = await rpc(supabase)("create_activity_opportunity", {
      p_registration_id: value.registrationId,
      p_owner_id: value.ownerId,
      p_next_action: value.nextAction,
      p_next_action_at: value.nextActionAt,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTIVITY_ERROR_CODES);
  }
}

export async function updateSalesOpportunityAction(
  input: ActivityOpportunityUpdateInput,
): Promise<ActionResult> {
  try {
    const value = parse(opportunityUpdateSchema, input);
    const supabase = await authorizedActivityClient("followup.write");
    const { error } = await rpc(supabase)("update_sales_opportunity", {
      p_opportunity_id: value.opportunityId,
      p_stage: value.stage,
      p_owner_id: value.ownerId,
      p_next_action: value.nextAction,
      p_next_action_at: value.nextActionAt ?? undefined,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTIVITY_ERROR_CODES);
  }
}

export async function searchStudentsForActivity(query: string) {
  const supabase = await authorizedActivityClient("activity.register");
  const value = parse(searchQuery, query);
  if (!value) return [];
  const escaped = value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const { data, error } = await supabase
    .from("students")
    .select("id,name,grade")
    .is("deleted_at", null)
    .ilike("name", `%${escaped}%`)
    .limit(10)
    .returns<Array<{ id: string; name: string; grade: number | null }>>();
  if (error) throw new Error(error.message);
  return data ?? [];
}
