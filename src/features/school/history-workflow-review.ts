import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { studentStageRpc } from "./student-stage-data";

const row = z.object({ key: z.string(), student_id: z.string().nullable(), lead_id: z.string().nullable(), record_id: z.string().nullable(),
  name: z.string(), reason: z.string(), latest_period: z.string().nullable(), decision: z.enum(["continue", "archive"]).nullable(),
  decided_at: z.string().nullable(), note: z.string().nullable() });
const schema = z.object({ pendingCount: z.number(), count: z.number(), rows: z.array(row) });
export type WorkflowReviewRow = z.infer<typeof row>;
export async function loadHistoryWorkflowReview(search = "", page = 1, status = "pending") {
  return schema.parse(await studentStageRpc(await createClient(), "list_history_workflow_review", { p_search: search, p_page: page, p_status: status }));
}
