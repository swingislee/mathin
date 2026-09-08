"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./actions/guards";
import { COMMON_CODES, datetime, parse, text, uuid } from "./actions/schemas";
import { invitationDraftIsComplete, INVITATION_KINDS, INVITATION_STATES, isAssessmentTimeOption, MAX_ASSESSMENT_TIME_OPTIONS } from "./invitation-contract";
import type { StudentStageEntryInput, StudentStageSaved, StudentStageOptions, StudentStageAssignment } from "./student-stage-contract";
import { parseStudentStageSaved, parseStudentStageAssignments, readStudentStageSubject, studentStageRpc } from "./student-stage-data";
import { listInvitationOptions } from "./invitations";
import { loadPhase3EnrollmentOptions } from "./phase3-enrollment-data";

const subjectSchema = z.object({ studentId: uuid.nullable(), leadId: uuid.nullable() }).refine(v => v.studentId || v.leadId);
const invitationSchema = z.object({
  kind: z.enum(INVITATION_KINDS), state: z.enum(INVITATION_STATES), activityId: uuid.nullable(), assessorId: uuid.nullable(),
  parentTimeOptions: z.array(z.string().refine(isAssessmentTimeOption)).max(MAX_ASSESSMENT_TIME_OPTIONS),
  assessorTimeOptions: z.array(z.string().refine(isAssessmentTimeOption)).max(MAX_ASSESSMENT_TIME_OPTIONS),
  scheduledAt: datetime.nullable(), locationText: text(200), nextContactAt: datetime.nullable().optional(),
}).refine(invitationDraftIsComplete);
const enrollmentSchema = z.object({
  courseId: uuid, termId: uuid, type: z.enum(["new","renewal","reactivate"]),
  stage: z.enum(["considering","committed","payment_pending","not_enrolled","nurturing"]),
  confirm: z.boolean(), paymentEvidence: text(1000), expectedOpportunityId: uuid.nullable(),
}).refine(v => !v.confirm || v.paymentEvidence.trim().length > 0);
const entrySchema = z.object({
  studentId: uuid.nullable(), leadId: uuid.nullable(), mode: z.enum(["note","contact","invitation","enrollment"]),
  note: text(2000), nextContactAt: datetime.nullable(), outcome: z.enum(["connected","unreachable","declined","invalid_number"]).nullable(),
  wechatAdded: z.boolean().nullable(), interestLevel: z.enum(["A","B","C"]).nullable(), invitation: invitationSchema.nullable(),
  expectedInvitationId: uuid.nullable(), expectedInvitationUpdatedAt: datetime.nullable(), enrollment: enrollmentSchema.nullable(),
}).refine(v => (v.studentId || v.leadId) && (v.mode !== "note" || v.note.trim())
  && (v.mode !== "contact" || v.outcome) && (v.mode !== "invitation" || v.invitation)
  && (v.mode !== "enrollment" || v.enrollment));
const saveSchema = z.object({ requestId: uuid, input: entrySchema });
const assignmentSchema = z.object({ staffUserId: uuid, subjects: z.array(z.object({ studentId: uuid.nullable(), leadId: uuid.nullable(), expectedOwnerId: uuid.nullable() })
  .refine(value => value.studentId || value.leadId)).min(1).max(100) });

export async function assignStudentStageAction(input: z.input<typeof assignmentSchema>): Promise<ActionResult<StudentStageAssignment[]>> {
  try {
    const value = parse(assignmentSchema, input);
    const { supabase } = await authorizedClient("student.assign");
    const result = parseStudentStageAssignments(await studentStageRpc(supabase, "assign_student_stage_subjects", {
      p_subjects: value.subjects, p_staff_user_id: value.staffUserId,
    }));
    revalidatePath("/[locale]/dashboard/students", "page");
    revalidatePath("/[locale]/dashboard/followups", "layout");
    revalidatePath("/[locale]/dashboard/leads", "page");
    return { ok: true, data: result };
  } catch (error) { return actionError<StudentStageAssignment[]>(error, [...COMMON_CODES,"ASSIGNMENT_CONFLICT","TARGET_CANNOT_FOLLOW_UP","LEAD_SCOPE_MISMATCH","FORBIDDEN_SCOPE","SUBJECT_MISMATCH"]); }
}

export async function saveStudentStageEntryAction(requestId: string, input: StudentStageEntryInput): Promise<ActionResult<StudentStageSaved>> {
  try {
    const value = parse(saveSchema, { requestId, input });
    const { supabase } = await authorizedClient("followup.write");
    const result = parseStudentStageSaved(await studentStageRpc(supabase, "save_student_record_entry", {
      p_request_id: value.requestId, p_payload: value.input,
    }));
    revalidatePath("/[locale]/dashboard/students", "page");
    revalidatePath("/[locale]/dashboard/followups", "layout");
    return { ok: true, data: result };
  } catch (error) {
    return actionError<StudentStageSaved>(error, [...COMMON_CODES, "FORBIDDEN_SCOPE", "SUBJECT_MISMATCH", "INVITATION_CONFLICT",
      "ACTIVE_INVITATION_EXISTS", "REQUEST_CONFLICT", "LEAD_UNASSIGNED", "LEAD_CLOSED", "STUDENT_PHONE_REQUIRED", "CONTACT_RESULT_REQUIRED",
      "REMINDER_NOT_FUTURE", "REMINDER_NOT_ALLOWED", "INVALID_INVITATION", "ACTIVITY_NOT_FOUND", "ASSESSOR_UNAVAILABLE",
      "IDENTITY_NOT_CONFIRMED", "PAYMENT_CONFIRMATION_REQUIRED", "OPPORTUNITY_CONFLICT", "OPPORTUNITY_ENROLLED", "OPPORTUNITY_CLOSED",
      "ALREADY_ENROLLED_FOR_COURSE", "COURSE_NOT_AVAILABLE", "TERM_NOT_FOUND", "OWNER_NOT_AVAILABLE", "FORBIDDEN_OWNER_ASSIGNMENT"]);
  }
}

export async function getStudentStageOptionsAction(subject: { studentId: string | null; leadId: string | null }): Promise<ActionResult<StudentStageOptions>> {
  try {
    const value = parse(subjectSchema, subject);
    const { supabase } = await authorizedClient("followup.write");
    const row = await readStudentStageSubject(supabase, value);
    const [invitations, enrollment, opportunities] = await Promise.all([
      listInvitationOptions(), loadPhase3EnrollmentOptions(), row.studentId
        ? supabase.from("course_opportunities").select("id,course_id,term_id,opportunity_type,stage,updated_at")
          .eq("student_id", row.studentId).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (opportunities.error) throw new Error(opportunities.error.message);
    return { ok: true as const, data: { row, invitations, enrollment, opportunities: (opportunities.data ?? []).flatMap(o =>
      o.course_id && o.term_id ? [{ ...o, course_id: o.course_id, term_id: o.term_id }] : []) } };
  } catch (error) { return actionError<StudentStageOptions>(error, [...COMMON_CODES,"FORBIDDEN_SCOPE","SUBJECT_MISMATCH"]); }
}
