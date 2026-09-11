import "server-only";

import { createClient } from "@/lib/supabase/server";
import { collectPostgrestRowsInBatches } from "@/lib/supabase/postgrest-batches";
import type { QuickFollowUpSaved } from "./QuickFollowUpEntry";

/** 班级名单只读取每位学生最近的一条日常记录，权限由原学生与跟进 RLS 核对。 */
export async function loadRosterFollowUps(studentIds: string[]): Promise<Record<string, QuickFollowUpSaved>> {
  if (!studentIds.length) return {};
  const supabase = await createClient();
  const students = await collectPostgrestRowsInBatches<string, {
    id: string; student_follow_ups: { content: string; created_at: string }[];
  }>(studentIds, batch => supabase.from("students")
    .select("id,student_follow_ups(content,created_at)")
    .in("id", batch)
    .order("created_at", { referencedTable: "student_follow_ups", ascending: false })
    .limit(1, { referencedTable: "student_follow_ups" }));
  return Object.fromEntries(students.flatMap(student => {
    const latest = student.student_follow_ups[0];
    return latest ? [[student.id, { content: latest.content, createdAt: latest.created_at }]] : [];
  }));
}
