"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./actions/guards";
import { datetime, parse, text, uuid } from "./actions/schemas";
import { CONTACT_CHANNELS, CONTACT_ROUTES, type ActivityEnrollmentContext, type EnrollmentPlacementBoard, type EnrollmentSourceRef, type EnrollmentWorkflowOptions } from "./enrollment-workflow-contract";
import { enrollmentWorkflowRpc, loadActivityEnrollmentContext, loadEnrollmentPlacementBoard, loadEnrollmentWorkflowOptions } from "./enrollment-workflow-data";

const sourceSchema = z.object({ registrationId: uuid.nullable(), invitationId: uuid.nullable() })
  .refine((input) => [input.registrationId, input.invitationId].filter(Boolean).length === 1);
const contactSchema = z.object({
  registrationId: uuid, requestId: uuid, channel: z.enum(CONTACT_CHANNELS), outcome: z.enum(["connected", "unreachable"]),
  route: z.enum(CONTACT_ROUTES), note: text(2000), nextContactAt: datetime.nullable(),
});
const enrollSchema = z.object({ registrationId: uuid, courseId: uuid, termId: uuid, classroomId: uuid.nullable(), note: text(2000) });
const moveSchema = z.object({ enrollmentId: uuid.nullable(), membershipId: uuid.nullable(), fromClassroomId: uuid.nullable(), toClassroomId: uuid.nullable() })
  .refine((value) => Boolean(value.enrollmentId || value.membershipId));
const ERRORS = [
  "FORBIDDEN_SCOPE", "FORBIDDEN", "UNAUTHENTICATED", "VALIDATION", "PARTICIPATION_NOT_COMPLETED", "IDENTITY_NOT_CONFIRMED",
  "IDEMPOTENCY_CONFLICT", "CLASS_TARGET_MISMATCH", "CLASS_FULL", "PLACEMENT_CHANGED", "CLASS_NOT_AVAILABLE",
  "ENROLLMENT_ALREADY_ASSIGNED", "ENROLLMENT_NOT_ACTIVE", "ENROLLMENT_CANCELLED", "COURSE_NOT_AVAILABLE", "TERM_NOT_FOUND",
  "OPPORTUNITY_NOT_CONFIRMABLE", "STUDENT_NOT_AVAILABLE", "CLASS_MEMBERSHIP_NOT_ACTIVE", "MEMBERSHIP_ALREADY_LINKED",
] as const;
function refreshEnrollmentWorkflow() {
  for (const path of ["assessments", "invitations", "enrollments", "opportunities"]) revalidatePath(`/[locale]/dashboard/${path}`, "page");
  revalidatePath("/[locale]/dashboard/activities", "layout");
  revalidatePath("/[locale]/dashboard/classes", "layout");
}
export async function getActivityEnrollmentContextAction(source: EnrollmentSourceRef): Promise<ActionResult<ActivityEnrollmentContext>> {
  try { return { ok: true, data: await loadActivityEnrollmentContext(parse(sourceSchema, source)) }; }
  catch (error) { return actionError(error, ERRORS); }
}
export async function getEnrollmentWorkflowOptionsAction(): Promise<ActionResult<EnrollmentWorkflowOptions>> {
  try {
    await authorizedClient("enrollment.manage");
    return { ok: true, data: await loadEnrollmentWorkflowOptions() };
  } catch (error) { return actionError(error, ERRORS); }
}
export async function savePostActivityContactAction(input: z.infer<typeof contactSchema>): Promise<ActionResult<ActivityEnrollmentContext>> {
  try {
    const value = parse(contactSchema, input);
    await authorizedClient("followup.write");
    await enrollmentWorkflowRpc("save_post_activity_contact", {
      p_registration_id: value.registrationId, p_request_id: value.requestId, p_channel: value.channel,
      p_outcome: value.outcome, p_route: value.route, p_note: value.note, p_next_contact_at: value.nextContactAt,
    });
    refreshEnrollmentWorkflow();
    return { ok: true, data: await loadActivityEnrollmentContext({ registrationId: value.registrationId, invitationId: null }) };
  } catch (error) { return actionError(error, ERRORS); }
}
export async function confirmActivityEnrollmentAction(input: z.infer<typeof enrollSchema>): Promise<ActionResult<ActivityEnrollmentContext>> {
  try {
    const value = parse(enrollSchema, input);
    await authorizedClient("enrollment.manage");
    await enrollmentWorkflowRpc("confirm_activity_enrollment", {
      p_registration_id: value.registrationId, p_course_id: value.courseId, p_term_id: value.termId,
      p_classroom_id: value.classroomId, p_note: value.note,
    });
    refreshEnrollmentWorkflow();
    return { ok: true, data: await loadActivityEnrollmentContext({ registrationId: value.registrationId, invitationId: null }) };
  } catch (error) { return actionError(error, ERRORS); }
}
export async function moveEnrollmentPlacementAction(input: z.infer<typeof moveSchema>): Promise<ActionResult<EnrollmentPlacementBoard>> {
  try {
    const value = parse(moveSchema, input);
    await authorizedClient("enrollment.manage");
    await enrollmentWorkflowRpc("move_enrollment_placement", {
      p_enrollment_id: value.enrollmentId, p_membership_id: value.membershipId,
      p_from_classroom_id: value.fromClassroomId, p_to_classroom_id: value.toClassroomId,
    });
    refreshEnrollmentWorkflow();
    return { ok: true, data: await loadEnrollmentPlacementBoard() };
  } catch (error) { return actionError(error, ERRORS); }
}
