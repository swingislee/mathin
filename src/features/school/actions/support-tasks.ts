"use server";

// ---------------------------------------------------------------------------
// 学辅任务完成/跳过（P4H-9 §9）。权限判定按任务 kind 分流，在 complete_support_task
// RPC 内部完成，无法用 authorizedClient 的单一权限键表达，这里只做登录闸+入参校验。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { COMMON_CODES, parse, text, uuid } from "./schemas";

const completeSchema = z.object({
  taskId: uuid,
  status: z.enum(["done", "skipped"]),
  note: text(1000),
});

export async function completeSupportTaskAction(taskId: string, status: "done" | "skipped", note = ""): Promise<ActionResult> {
  try {
    const value = parse(completeSchema, { taskId, status, note });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const { error } = await supabase.rpc("complete_support_task", {
      p_task_id: value.taskId,
      p_status: value.status,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["TASK_NOT_FOUND", "TASK_ALREADY_COMPLETED", "FORBIDDEN_SCOPE", ...COMMON_CODES]);
  }
}
