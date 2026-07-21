import "server-only";

import { createClient } from "@/lib/supabase/server";

export type SupportTaskKind = "preclass_notice" | "absence_check" | "makeup_followup" | "postclass_followup" | "renewal_followup";
export type SupportTaskStatus = "pending" | "done" | "skipped" | "invalidated";

export interface SupportTaskRow {
  id: string;
  classroomId: string;
  classroomName: string;
  sessionId: string | null;
  sessionTitle: string | null;
  kind: SupportTaskKind;
  status: SupportTaskStatus;
  dueAt: string | null;
  note: string;
}

/** 学辅任务列表（P4H-9 §9）；不传 status 时按 RPC 默认只看 pending。 */
export async function listMySupportTasks(status?: SupportTaskStatus): Promise<SupportTaskRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_support_tasks", { p_status: status ?? "pending" });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row): SupportTaskRow => ({
    id: row.id,
    classroomId: row.classroom_id,
    classroomName: row.classroom_name,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    kind: row.kind as SupportTaskKind,
    status: row.status as SupportTaskStatus,
    dueAt: row.due_at,
    note: row.note,
  }));
}
