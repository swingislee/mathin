"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import {
  TEACHER_PROFESSIONAL_SIGNAL_TYPES,
} from "../renewal-contract";
import { authorizedClient } from "./guards";
import { COMMON_CODES, dateOnly, datetime, parse, requiredText, text, uuid } from "./schemas";

interface RpcResult<T> {
  data: T | null;
  error: { message: string } | null;
}

type UntypedRpc<T> = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult<T>>;

function rpc<T>(supabase: { rpc: unknown }): UntypedRpc<T> {
  return (supabase.rpc as UntypedRpc<T>).bind(supabase);
}

const EDITABLE_OPPORTUNITY_STAGES = [
  "planning",
  "contacted",
  "considering",
  "committed",
  "payment_pending",
  "not_enrolled",
  "nurturing",
] as const;

function refreshRenewals() {
  revalidatePath("/[locale]/dashboard/followups/renewals", "layout");
  revalidatePath("/[locale]/dashboard/opportunities", "page");
}

const cycleSchema = z.object({
  name: requiredText(160),
  sourceTermId: uuid,
  targetTermId: uuid,
  preparationStartsOn: dateOnly.nullable(),
  decisionDueOn: dateOnly.nullable(),
});

const prepareRenewalSchema = z.object({
  cycleId: uuid,
  membershipIds: z.array(uuid).min(1).max(200),
  ownerId: uuid,
  nextAction: requiredText(500),
  nextActionAt: datetime,
});

const signalSchema = z.object({
  studentId: uuid,
  sourceMembershipId: uuid,
  sourceSessionId: uuid.nullable(),
  signalType: z.enum(TEACHER_PROFESSIONAL_SIGNAL_TYPES),
  recommendation: requiredText(2000),
  suggestedCourseId: uuid.nullable(),
  targetTermId: uuid.nullable(),
});

const resolveSignalSchema = z.object({
  signalId: uuid,
  resolution: z.enum(["accept", "dismiss"]),
  courseId: uuid.nullable(),
  termId: uuid.nullable(),
  ownerId: uuid.nullable(),
  nextAction: text(500),
  nextActionAt: datetime.nullable(),
  note: text(2000),
});

const longTermOpportunitySchema = z.object({
  studentId: uuid,
  courseId: uuid,
  termId: uuid,
  ownerId: uuid,
  nextAction: requiredText(500),
  nextActionAt: datetime,
  note: text(2000),
});

const updateOpportunitySchema = z.object({
  opportunityId: uuid,
  opportunityType: z.enum(["renewal", "upsell", "reactivate", "referral"]),
  courseId: uuid,
  termId: uuid,
  stage: z.enum(EDITABLE_OPPORTUNITY_STAGES),
  ownerId: uuid,
  nextAction: text(500),
  nextActionAt: datetime.nullable(),
  note: text(2000),
});

const referralSchema = z.object({
  referrerStudentId: uuid,
  referrerFamilyId: uuid.nullable(),
  referrerContactId: uuid.nullable(),
  referredLeadId: uuid.nullable(),
  referredSourceRecordId: uuid.nullable(),
  newLeadName: text(100).nullable(),
  newLeadPhone: text(40).nullable(),
  newLeadGradeHint: z.number().int().min(1).max(12).nullable(),
  relationship: text(120),
  note: text(2000),
}).superRefine((value, context) => {
  const hasExisting = value.referredLeadId !== null;
  const hasNew = Boolean(value.newLeadName || value.newLeadPhone || value.newLeadGradeHint !== null);
  if (hasExisting === hasNew || (hasNew && (!value.newLeadName || !value.newLeadPhone))) {
    context.addIssue({ code: "custom", message: "VALIDATION" });
  }
});

const referralOpportunitySchema = z.object({
  referralId: uuid,
  courseId: uuid,
  termId: uuid,
  ownerId: uuid,
  nextAction: requiredText(500),
  nextActionAt: datetime,
  note: text(2000),
});

const ACTION_CODES = [
  "FORBIDDEN_SCOPE",
  "INVALID_OWNER",
  "INVALID_OPPORTUNITY_SOURCE",
  "INVALID_OPPORTUNITY",
  "IMMUTABLE_OPPORTUNITY_SOURCE",
  "OPPORTUNITY_TARGET_CONFLICT",
  "INVALID_OPPORTUNITY_TRANSITION",
  "OPPORTUNITY_NOT_FOUND",
  "OPPORTUNITY_ENROLLED",
  "INVALID_TERM_SEQUENCE",
  "INVALID_CYCLE_STATE",
  "INVALID_MEMBERSHIP",
  "COURSE_REQUIRED",
  "OPPORTUNITY_CLOSED",
  "SIGNAL_ALREADY_HANDLED",
  "SIGNAL_CONTEXT_REQUIRED",
  "LEAD_ALREADY_REFERRED",
  "LEAD_SCOPE_MISMATCH",
  "LEAD_IDENTITY_REQUIRED",
  "COURSE_NOT_AVAILABLE",
  "TERM_NOT_FOUND",
  "STUDENT_NOT_AVAILABLE",
  "OWNER_NOT_AVAILABLE",
  "FORBIDDEN_OWNER_ASSIGNMENT",
  "NOT_FOUND",
  ...COMMON_CODES,
] as const;

export async function createRenewalCycleAction(input: z.input<typeof cycleSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const value = parse(cycleSchema, input);
    const { supabase } = await authorizedClient("followup.write");
    const { data, error } = await rpc<string>(supabase)("create_renewal_cycle", {
      p_name: value.name,
      p_source_term_id: value.sourceTermId,
      p_target_term_id: value.targetTermId,
      p_preparation_starts_on: value.preparationStartsOn,
      p_decision_due_on: value.decisionDueOn,
    });
    if (error) throw new Error(error.message);
    refreshRenewals();
    return { ok: true, data: { id: data ?? "" } };
  } catch (error) {
    return actionError(error, ACTION_CODES);
  }
}

export async function setRenewalCycleStatusAction(
  cycleId: string,
  status: "planning" | "open" | "closed",
): Promise<ActionResult> {
  try {
    const value = parse(z.object({ cycleId: uuid, status: z.enum(["planning", "open", "closed"]) }), { cycleId, status });
    const { supabase } = await authorizedClient("followup.write");
    const { error } = await rpc<null>(supabase)("set_renewal_cycle_status", {
      p_cycle_id: value.cycleId,
      p_status: value.status,
    });
    if (error) throw new Error(error.message);
    refreshRenewals();
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTION_CODES);
  }
}

export async function snapshotRenewalCycleMembershipsAction(
  cycleId: string,
): Promise<ActionResult<{ added: number; eligible: number }>> {
  try {
    const id = parse(uuid, cycleId);
    const { supabase } = await authorizedClient("followup.write");
    const { data, error } = await rpc<{ added: number; eligible: number }>(supabase)("snapshot_renewal_cycle_memberships", {
      p_cycle_id: id,
    });
    if (error) throw new Error(error.message);
    refreshRenewals();
    return { ok: true, data: data ?? { added: 0, eligible: 0 } };
  } catch (error) {
    return actionError(error, ACTION_CODES);
  }
}

export async function prepareRenewalOpportunitiesAction(
  input: z.input<typeof prepareRenewalSchema>,
): Promise<ActionResult<{ created: number; reused: number }>> {
  try {
    const value = parse(prepareRenewalSchema, input);
    const { supabase } = await authorizedClient("followup.write");
    const { data, error } = await rpc<{ created: number; reused: number }>(supabase)("prepare_renewal_opportunities", {
      p_cycle_id: value.cycleId,
      p_membership_ids: value.membershipIds,
      p_owner_id: value.ownerId,
      p_next_action: value.nextAction,
      p_next_action_at: value.nextActionAt,
    });
    if (error) throw new Error(error.message);
    refreshRenewals();
    return { ok: true, data: data ?? { created: 0, reused: 0 } };
  } catch (error) {
    return actionError(error, ACTION_CODES);
  }
}

export async function createTeacherProfessionalSignalAction(
  input: z.input<typeof signalSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const value = parse(signalSchema, input);
    const { supabase } = await authorizedClient("review.write");
    const { data, error } = await rpc<string>(supabase)("create_teacher_professional_signal", {
      p_student_id: value.studentId,
      p_source_membership_id: value.sourceMembershipId,
      p_source_session_id: value.sourceSessionId,
      p_signal_type: value.signalType,
      p_recommendation: value.recommendation,
      p_suggested_course_id: value.suggestedCourseId,
      p_target_term_id: value.targetTermId,
    });
    if (error) throw new Error(error.message);
    refreshRenewals();
    return { ok: true, data: { id: data ?? "" } };
  } catch (error) {
    return actionError(error, ACTION_CODES);
  }
}

export async function resolveTeacherProfessionalSignalAction(
  input: z.input<typeof resolveSignalSchema>,
): Promise<ActionResult<{ opportunityId: string | null }>> {
  try {
    const value = parse(resolveSignalSchema, input);
    const { supabase } = await authorizedClient("followup.write");
    const { data, error } = await rpc<string | null>(supabase)("resolve_teacher_professional_signal", {
      p_signal_id: value.signalId,
      p_resolution: value.resolution,
      p_course_id: value.courseId,
      p_term_id: value.termId,
      p_owner_id: value.ownerId,
      p_next_action: value.nextAction,
      p_next_action_at: value.nextActionAt,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    refreshRenewals();
    return { ok: true, data: { opportunityId: data } };
  } catch (error) {
    return actionError(error, ACTION_CODES);
  }
}

export async function createReactivationOpportunityAction(
  input: z.input<typeof longTermOpportunitySchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const value = parse(longTermOpportunitySchema, input);
    const { supabase } = await authorizedClient("followup.write");
    const { data, error } = await rpc<string>(supabase)("save_course_opportunity", {
      p_opportunity_id: null,
      p_activity_route_id: null,
      p_student_id: value.studentId,
      p_lead_id: null,
      p_opportunity_type: "reactivate",
      p_course_id: value.courseId,
      p_term_id: value.termId,
      p_stage: "planning",
      p_owner_id: value.ownerId,
      p_next_action: value.nextAction,
      p_next_action_at: value.nextActionAt,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    refreshRenewals();
    return { ok: true, data: { id: data ?? "" } };
  } catch (error) {
    return actionError(error, ACTION_CODES);
  }
}

export async function updateLongTermOpportunityAction(
  input: z.input<typeof updateOpportunitySchema>,
): Promise<ActionResult> {
  try {
    const value = parse(updateOpportunitySchema, input);
    const { supabase } = await authorizedClient("followup.write");
    const { error } = await rpc<string>(supabase)("save_course_opportunity", {
      p_opportunity_id: value.opportunityId,
      p_activity_route_id: null,
      p_student_id: null,
      p_lead_id: null,
      p_opportunity_type: value.opportunityType,
      p_course_id: value.courseId,
      p_term_id: value.termId,
      p_stage: value.stage,
      p_owner_id: value.ownerId,
      p_next_action: value.nextAction,
      p_next_action_at: value.nextActionAt,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    refreshRenewals();
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTION_CODES);
  }
}

export async function attachStudentReferralSourceAction(
  input: z.input<typeof referralSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const value = parse(referralSchema, input);
    const { supabase } = await authorizedClient("followup.write");
    const { data, error } = await rpc<string>(supabase)("attach_student_referral_source", {
      p_referrer_student_id: value.referrerStudentId,
      p_referrer_family_id: value.referrerFamilyId,
      p_referrer_contact_id: value.referrerContactId,
      p_referred_lead_id: value.referredLeadId,
      p_referred_source_record_id: value.referredSourceRecordId,
      p_new_lead_name: value.newLeadName,
      p_new_lead_phone: value.newLeadPhone,
      p_new_lead_grade_hint: value.newLeadGradeHint,
      p_relationship: value.relationship,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    refreshRenewals();
    return { ok: true, data: { id: data ?? "" } };
  } catch (error) {
    return actionError(error, ACTION_CODES);
  }
}

export async function convertStudentReferralToOpportunityAction(
  input: z.input<typeof referralOpportunitySchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const value = parse(referralOpportunitySchema, input);
    const { supabase } = await authorizedClient("followup.write");
    const { data, error } = await rpc<string>(supabase)("convert_student_referral_to_opportunity", {
      p_referral_id: value.referralId,
      p_course_id: value.courseId,
      p_term_id: value.termId,
      p_owner_id: value.ownerId,
      p_next_action: value.nextAction,
      p_next_action_at: value.nextActionAt,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    refreshRenewals();
    return { ok: true, data: { id: data ?? "" } };
  } catch (error) {
    return actionError(error, ACTION_CODES);
  }
}
