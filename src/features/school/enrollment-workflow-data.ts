import "server-only";
import { z } from "zod";
import { sessionTransferSchema } from './enrollment-placement-change-contract';
import { createClient } from "@/lib/supabase/server";
import { readSchoolQueryBatches } from "./school-query-pages";
import { renewalHealthSignals, type RenewalHealthFacts } from "./renewal-health-contract";
import {
  enrollmentSchema, activityEnrollmentContextSchema, enrollmentWorkflowOptionsSchema, placementMemberSchema,
  type EnrollmentPlacementBoard, type EnrollmentSourceRef,
} from "./enrollment-workflow-contract";

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export async function enrollmentWorkflowRpc(name: string, args?: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc).call(supabase, name, args);
  if (error) throw new Error(error.message);
  return data;
}
export async function loadActivityEnrollmentContext(source: EnrollmentSourceRef) {
  return activityEnrollmentContextSchema.parse(await enrollmentWorkflowRpc("get_activity_enrollment_context", {
    p_registration_id: source.registrationId, p_invitation_id: source.invitationId,
  }));
}
export async function loadPostActivityFollowups() {
  return z.array(activityEnrollmentContextSchema).parse(await enrollmentWorkflowRpc("get_post_activity_followups"));
}
export async function loadEnrollmentWorkflowOptions() {
  return enrollmentWorkflowOptionsSchema.parse(await enrollmentWorkflowRpc("get_enrollment_workflow_options"));
}
export async function loadEnrollmentPlacementBoard(): Promise<EnrollmentPlacementBoard> {
  const board = z.object({ options: enrollmentWorkflowOptionsSchema, enrollments: z.array(enrollmentSchema), members: z.array(placementMemberSchema) })
    .parse(await enrollmentWorkflowRpc("get_enrollment_placement_board"));
  const supabase = await createClient();
  const teachers = await readSchoolQueryBatches(board.options.classrooms.map(row => row.id), (batch, start, end) =>
    supabase.from("classroom_staff_assignments").select("classroom_id,user_id,profiles!classroom_staff_assignments_user_id_fkey(display_name)")
      .in("classroom_id", batch).in("responsibility", ["primary_teacher", "assistant_teacher"])
      .order("classroom_id").order("user_id").order("responsibility").range(start, end));
  if (teachers.error) throw new Error("PLACEMENT_TEACHER_FIELDS_READ");
  board.options.classrooms = board.options.classrooms.map(row => ({ ...row, teachers: (teachers.data ?? [])
    .filter(item => item.classroom_id === row.id).map(item => ({ id: item.user_id, name: item.profiles?.display_name ?? "" })) }));
  const renewalEntries = await readSchoolQueryBatches(board.members.map(row => row.membershipId), (batch, start, end) =>
    supabase.from("renewal_cycle_entries").select("source_class_membership_id,opportunity_id")
      .in("source_class_membership_id", batch).order("renewal_cycle_id").order("source_class_membership_id").range(start, end));
  if (renewalEntries.error) throw new Error("PLACEMENT_RENEWAL_FIELDS_READ");
  const renewedOpportunities = new Set(board.enrollments.filter(row => row.status === "active").map(row => row.opportunityId));
  const renewedMembershipIds = [...new Set((renewalEntries.data ?? []).filter(row => row.opportunity_id && renewedOpportunities.has(row.opportunity_id))
    .map(row => row.source_class_membership_id))];
  const ids = [...new Set([...board.enrollments.map((row) => row.studentId), ...board.members.map((row) => row.studentId)])];
  const health: NonNullable<EnrollmentPlacementBoard["health"]> = {};
  const now = Date.now();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const response = await supabase.rpc("get_renewal_health_facts", { p_student_ids: ids.slice(offset, offset + 200) });
    if (response.error) {
      if (response.error.message.includes("FORBIDDEN")) break;
      throw new Error(response.error.message);
    }
    for (const facts of response.data as unknown as RenewalHealthFacts[]) health[facts.studentId] = renewalHealthSignals(facts, now);
  }
  const sessionTransfers=z.array(sessionTransferSchema).parse(await enrollmentWorkflowRpc('get_enrollment_session_transfers'));
  return { ...board, health, renewedMembershipIds, sessionTransfers };
}
