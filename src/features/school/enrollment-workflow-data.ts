import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
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
  return { ...board, health };
}
