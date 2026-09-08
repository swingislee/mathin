"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { studentStageRpc } from "./student-stage-data";
const schema = z.object({ key: z.string().min(1).max(200), decision: z.enum(["continue", "archive"]), note: z.string().trim().min(1).max(1000), expectedAt: z.string().nullable() });
export async function decideHistoryWorkflowReview(input: z.infer<typeof schema>) {
  try {
    const value = schema.parse(input);
    await studentStageRpc(await createClient(), "decide_history_workflow_review", { p_key: value.key, p_decision: value.decision, p_note: value.note, p_expected_at: value.expectedAt });
    revalidatePath("/[locale]/dashboard/students", "page");
    return { ok: true as const };
  } catch (error) { return actionError(error, ["UNAUTHENTICATED", "FORBIDDEN", "VALIDATION", "NOT_FOUND", "CONFLICT"]); }
}
