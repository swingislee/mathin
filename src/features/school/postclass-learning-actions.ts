"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./actions/guards";
import { COMMON_CODES, parse, requiredText, uuid } from "./actions/schemas";
import { postclassLearningSchema, postclassReviewSchema, type PostclassLearning } from "./postclass-learning-contract";
import { LEARNING_CHECK_STATUSES } from "./session-learning-contract";

const readSchema = z.object({ sessionId: uuid });
const saveSchema = z.object({ sessionId: uuid, revision: requiredText(100),
  checks: z.array(z.object({ id: uuid, title: requiredText(100) })).max(30),
  changes: z.array(z.object({ checkId: uuid, studentId: uuid, status: z.enum(LEARNING_CHECK_STATUSES) })).max(1800),
  reviews: z.array(postclassReviewSchema).max(200),
});

export async function readPostclassLearning(sessionId: string): Promise<ActionResult<PostclassLearning>> {
  try {
    const value = parse(readSchema, { sessionId });
    const { supabase } = await authorizedClient("attendance.mark");
    const { data, error } = await supabase.rpc("get_session_learning_edit", { p_session_id: value.sessionId });
    if (error) throw new Error(error.message);
    return { ok: true, data: postclassLearningSchema.parse(data) };
  } catch (error) { return actionError(error, [...COMMON_CODES, "SESSION_NOT_FOUND"]); }
}
export async function savePostclassLearning(input: z.infer<typeof saveSchema>): Promise<ActionResult<PostclassLearning>> {
  try {
    const value = parse(saveSchema, input);
    const { supabase } = await authorizedClient("attendance.mark");
    const { data, error } = await supabase.rpc("save_session_learning_edit", {
      p_session_id: value.sessionId, p_revision: value.revision, p_checks: value.checks, p_changes: value.changes, p_reviews: value.reviews,
    });
    if (error) throw new Error(error.message);
    revalidatePath(`/[locale]/dashboard/sessions/${value.sessionId}`, "page");
    revalidatePath("/[locale]/dashboard/classes", "layout");
    return { ok: true, data: postclassLearningSchema.parse(data) };
  } catch (error) { return actionError(error, [...COMMON_CODES, "CONFLICT", "SESSION_NOT_FOUND"]); }
}
