"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./actions/guards";
import { COMMON_CODES, intInRange, parse, requiredText, text, uuid } from "./actions/schemas";
import { LEARNING_CHECK_STATUSES } from "./session-learning-contract";
import { assignmentQuestionResultSchema, assignmentQuestionWorkbookSchema, type AssignmentQuestionChange, type AssignmentQuestionResult, type AssignmentQuestionWorkbook } from "./assignment-question-contract";

const addSchema = z.object({ assignmentId: uuid, titles: z.array(requiredText(100)).min(1).max(60) });
const saveSchema = z.object({ assignmentId: uuid, changes: z.array(z.object({
  questionId: uuid, studentId: uuid, status: z.enum(LEARNING_CHECK_STATUSES), note: text(2000), expectedVersion: intInRange(0, 2147483646),
})).min(1).max(200) });

export async function addAssignmentQuestionsAction(input: { assignmentId: string; titles: string[] }): Promise<ActionResult<AssignmentQuestionWorkbook>> {
  try {
    const value = parse(addSchema, input);
    const { supabase } = await authorizedClient("review.write");
    const { data, error } = await supabase.rpc("add_assignment_questions", { p_assignment_id: value.assignmentId, p_titles: value.titles });
    if (error) throw new Error(error.message);
    return { ok: true, data: assignmentQuestionWorkbookSchema.parse(data) };
  } catch (error) { return actionError(error, ["FORBIDDEN", "QUESTION_LIMIT", ...COMMON_CODES]); }
}

export async function saveAssignmentQuestionResultsAction(input: { assignmentId: string; changes: AssignmentQuestionChange[] }): Promise<ActionResult<AssignmentQuestionResult[]>> {
  try {
    const value = parse(saveSchema, input);
    const { supabase } = await authorizedClient("review.write");
    const { data, error } = await supabase.rpc("save_assignment_question_results", { p_assignment_id: value.assignmentId, p_changes: value.changes });
    if (error) throw new Error(error.message);
    return { ok: true, data: z.array(assignmentQuestionResultSchema).parse(data) };
  } catch (error) { return actionError(error, ["FORBIDDEN", "CONFLICT", ...COMMON_CODES]); }
}
