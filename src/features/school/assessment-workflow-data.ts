import "server-only";
import { createClient } from "@/lib/supabase/server";
import { assessmentWorkflowFromDb, type AssessmentWorkflow } from "./assessment-workflow-contract";

export const ASSESSMENT_WORKFLOW_COLUMNS = "*,recorder:profiles!assessment_workflow_states_updated_by_fkey(display_name),sender:profiles!assessment_workflow_states_sent_by_fkey(display_name),report:assessment_reports!assessment_workflow_states_report_id_fkey(id,version,payload,created_at)";

export async function readAssessmentWorkflow(registrationId: string, client?: Awaited<ReturnType<typeof createClient>>): Promise<AssessmentWorkflow | null> {
  const supabase = client ?? await createClient();
  const { data, error } = await supabase.from("assessment_workflow_states").select(ASSESSMENT_WORKFLOW_COLUMNS)
    .eq("registration_id", registrationId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? assessmentWorkflowFromDb(data) : null;
}
