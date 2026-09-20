import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ClassroomWorkSession } from "./classroom-workbench-contract";
import { readSchoolQueryBatches } from "./school-query-pages";

export async function getClassroomWorkSessions(classroomIds: string[]): Promise<ClassroomWorkSession[]> {
  if (!classroomIds.length) return [];
  const supabase = await createClient();
  const { data, error } = await readSchoolQueryBatches(classroomIds, (batch, start, end) => supabase.from("class_sessions")
      .select("id,classroom_id,title,scheduled_at,started_at,ended_at")
      .in("classroom_id", batch).is("deleted_at", null).is("voided_at", null).is("cancelled_by", null)
      .order("scheduled_at").order("id").range(start, end));
  if (error) throw new Error(error.message);
  return (data ?? []).map(row => ({ id: row.id, classroomId: row.classroom_id, title: row.title,
    scheduledAt: row.scheduled_at, startedAt: row.started_at, endedAt: row.ended_at }));
}
