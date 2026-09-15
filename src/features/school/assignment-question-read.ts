import "server-only";
import { createClient } from "@/lib/supabase/server";
import { assignmentQuestionWorkbookSchema } from "./assignment-question-contract";

export async function getAssignmentQuestionWorkbook(assignmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_assignment_question_workbook", { p_assignment_id: assignmentId });
  if (error) throw new Error(error.message);
  return assignmentQuestionWorkbookSchema.parse(data);
}
