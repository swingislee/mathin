"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient, nullableRpcArg } from "./actions/guards";
import { datetime, parse, requiredText, text, uuid } from "./actions/schemas";
import {
  COURSE_OPPORTUNITY_TYPES,
  type SaveCourseOpportunityInput,
} from "./phase3-enrollment-contract";

type UntypedRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return (supabase.rpc as UntypedRpc).bind(supabase);
}

const editableStages = [
  "planning",
  "contacted",
  "considering",
  "committed",
  "payment_pending",
  "not_enrolled",
  "nurturing",
] as const;

const nullableDatetime = z.union([datetime, z.null()]);
const saveOpportunitySchema = z.object({
  opportunityId: uuid.nullable(),
  activityRouteId: uuid.nullable(),
  studentId: uuid.nullable(),
  leadId: uuid.nullable(),
  opportunityType: z.enum(COURSE_OPPORTUNITY_TYPES),
  courseId: uuid,
  termId: uuid,
  stage: z.enum(editableStages),
  ownerId: uuid.nullable(),
  nextAction: text(500),
  nextActionAt: nullableDatetime,
  note: text(2_000),
}).superRefine((value, context) => {
  const sourceCount = [value.activityRouteId, value.studentId, value.leadId]
    .filter(Boolean).length;
  const valid = value.opportunityId === null ? sourceCount === 1 : sourceCount === 0;
  if (!valid) context.addIssue({ code: "custom", message: "INVALID_OPPORTUNITY_SOURCE" });
});

const ERROR_CODES = [
  "ACTIVITY_ROUTE_NOT_FOUND",
  "ACTIVITY_ROUTE_CLOSED",
  "INVALID_OPPORTUNITY_SOURCE",
  "INVALID_OPPORTUNITY",
  "IMMUTABLE_OPPORTUNITY_SOURCE",
  "OPPORTUNITY_TARGET_CONFLICT",
  "INVALID_OPPORTUNITY_TRANSITION",
  "OPPORTUNITY_NOT_FOUND",
  "OPPORTUNITY_ENROLLED",
  "OPPORTUNITY_CLOSED",
  "OPPORTUNITY_NOT_CONFIRMABLE",
  "IDENTITY_NOT_CONFIRMED",
  "ENROLLMENT_CANCELLED",
  "ENROLLMENT_NOT_FOUND",
  "INVALID_ENROLLMENT",
  "ENROLLMENT_STILL_ASSIGNED",
  "ALREADY_ENROLLED_FOR_COURSE",
  "ENROLLMENT_NOT_ACTIVE",
  "ENROLLMENT_ALREADY_ASSIGNED",
  "ENROLLMENT_NOT_ASSIGNED",
  "CLASS_NOT_AVAILABLE",
  "CLASS_TARGET_MISMATCH",
  "CLASS_FULL",
  "CLASS_MEMBERSHIP_NOT_ACTIVE",
  "MEMBERSHIP_ALREADY_LINKED",
  "INVALID_ASSIGNMENT_BATCH",
  "INVALID_ASSIGNMENT",
  "SAME_CLASSROOM",
  "INVALID_EFFECTIVE_AT",
  "COURSE_NOT_AVAILABLE",
  "TERM_NOT_FOUND",
  "STUDENT_NOT_AVAILABLE",
  "LEAD_NOT_AVAILABLE",
  "OWNER_NOT_AVAILABLE",
  "FORBIDDEN_OWNER_ASSIGNMENT",
  "FORBIDDEN_SCOPE",
  "FORBIDDEN",
  "UNAUTHENTICATED",
  "VALIDATION",
] as const;

function refreshPhase3() {
  revalidatePath("/[locale]/dashboard/opportunities", "page");
  revalidatePath("/[locale]/dashboard/followups/enrollments", "page");
  revalidatePath("/[locale]/dashboard/classes", "layout");
}

export async function saveCourseOpportunityAction(
  input: SaveCourseOpportunityInput,
): Promise<ActionResult<{ opportunityId: string }>> {
  try {
    const value = parse(saveOpportunitySchema, input);
    const { supabase } = await authorizedClient("followup.write");
    const { data, error } = await rpc(supabase)("save_course_opportunity", {
      p_opportunity_id: nullableRpcArg(value.opportunityId),
      p_activity_route_id: nullableRpcArg(value.activityRouteId),
      p_student_id: nullableRpcArg(value.studentId),
      p_lead_id: nullableRpcArg(value.leadId),
      p_opportunity_type: value.opportunityType,
      p_course_id: value.courseId,
      p_term_id: value.termId,
      p_stage: value.stage,
      p_owner_id: nullableRpcArg(value.ownerId),
      p_next_action: value.nextAction,
      p_next_action_at: nullableRpcArg(value.nextActionAt),
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    const opportunityId = uuid.parse(data);
    refreshPhase3();
    return { ok: true, data: { opportunityId } };
  } catch (error) {
    return actionError<{ opportunityId: string }>(error, ERROR_CODES);
  }
}

const noteSchema = z.object({ id: uuid, note: text(2_000) });
const effectiveSchema = noteSchema.extend({ effectiveAt: datetime });
const cancellationSchema = z.object({ id: uuid, note: requiredText(2_000), effectiveAt: datetime });
const assignmentSchema = effectiveSchema.extend({ classroomId: uuid });

export async function confirmCourseEnrollmentAction(
  opportunityId: string,
  note: string,
): Promise<ActionResult<{ enrollmentId: string }>> {
  try {
    const value = parse(noteSchema, { id: opportunityId, note });
    const { supabase } = await authorizedClient("enrollment.manage");
    const { data, error } = await rpc(supabase)("confirm_course_enrollment", {
      p_opportunity_id: value.id,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    const enrollmentId = uuid.parse(data);
    refreshPhase3();
    return { ok: true, data: { enrollmentId } };
  } catch (error) {
    return actionError<{ enrollmentId: string }>(error, ERROR_CODES);
  }
}

export async function assignCourseEnrollmentAction(
  enrollmentId: string,
  classroomId: string,
  note: string,
  effectiveAt: string,
): Promise<ActionResult<{ effectiveAt: string }>> {
  try {
    const value = parse(assignmentSchema, { id: enrollmentId, classroomId, note, effectiveAt });
    const { supabase } = await authorizedClient("enrollment.manage");
    const { error } = await rpc(supabase)("assign_course_enrollment", {
      p_course_enrollment_id: value.id,
      p_classroom_id: value.classroomId,
      p_note: value.note,
      p_effective_at: value.effectiveAt,
    });
    if (error) throw new Error(error.message);
    refreshPhase3();
    return { ok: true, data: { effectiveAt: value.effectiveAt } };
  } catch (error) {
    return actionError<{ effectiveAt: string }>(error, ERROR_CODES);
  }
}

export async function assignCourseEnrollmentsAction(
  enrollmentIds: string[],
  classroomId: string,
  note: string,
  effectiveAt: string,
): Promise<ActionResult<{ count: number; effectiveAt: string }>> {
  try {
    const value = parse(z.object({
      ids: z.array(uuid).min(1).max(200),
      classroomId: uuid,
      note: text(2_000),
      effectiveAt: datetime,
    }), { ids: enrollmentIds, classroomId, note, effectiveAt });
    const { supabase } = await authorizedClient("enrollment.manage");
    const { data, error } = await rpc(supabase)("assign_course_enrollments", {
      p_course_enrollment_ids: value.ids,
      p_classroom_id: value.classroomId,
      p_note: value.note,
      p_effective_at: value.effectiveAt,
    });
    if (error) throw new Error(error.message);
    const count = z.number().int().nonnegative().parse(data);
    refreshPhase3();
    return { ok: true, data: { count, effectiveAt: value.effectiveAt } };
  } catch (error) {
    return actionError<{ count: number; effectiveAt: string }>(error, ERROR_CODES);
  }
}

export async function transferCourseEnrollmentAction(
  enrollmentId: string,
  classroomId: string,
  note: string,
  effectiveAt: string,
): Promise<ActionResult<{ effectiveAt: string }>> {
  try {
    const value = parse(assignmentSchema, { id: enrollmentId, classroomId, note, effectiveAt });
    const { supabase } = await authorizedClient("enrollment.manage");
    const { error } = await rpc(supabase)("transfer_course_enrollment", {
      p_course_enrollment_id: value.id,
      p_to_classroom_id: value.classroomId,
      p_note: value.note,
      p_effective_at: value.effectiveAt,
    });
    if (error) throw new Error(error.message);
    refreshPhase3();
    return { ok: true, data: { effectiveAt: value.effectiveAt } };
  } catch (error) {
    return actionError<{ effectiveAt: string }>(error, ERROR_CODES);
  }
}

export async function cancelCourseEnrollmentAction(
  enrollmentId: string,
  note: string,
  effectiveAt: string,
): Promise<ActionResult<{ effectiveAt: string }>> {
  try {
    const value = parse(cancellationSchema, { id: enrollmentId, note, effectiveAt });
    const { supabase } = await authorizedClient("enrollment.manage");
    const { error } = await rpc(supabase)("cancel_course_enrollment", {
      p_course_enrollment_id: value.id,
      p_note: value.note,
      p_effective_at: value.effectiveAt,
    });
    if (error) throw new Error(error.message);
    refreshPhase3();
    return { ok: true, data: { effectiveAt: value.effectiveAt } };
  } catch (error) {
    return actionError<{ effectiveAt: string }>(error, ERROR_CODES);
  }
}
