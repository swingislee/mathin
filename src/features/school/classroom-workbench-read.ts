import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ClassroomWorkSession } from "./classroom-workbench-contract";

export async function getClassroomWorkSessions(classroomIds: string[]): Promise<ClassroomWorkSession[]> {
  if (!classroomIds.length) return [];
  const supabase = await createClient();
  const sessions: ClassroomWorkSession[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("class_sessions")
      .select("id,classroom_id,title,scheduled_at,started_at,ended_at")
      .in("classroom_id", classroomIds).is("deleted_at", null).is("voided_at", null).is("cancelled_by", null)
      .order("scheduled_at").order("id").range(offset, offset + 999);
    if (error) throw new Error(error.message);
    sessions.push(...data.map(row => ({ id: row.id, classroomId: row.classroom_id, title: row.title,
      scheduledAt: row.scheduled_at, startedAt: row.started_at, endedAt: row.ended_at })));
    if (data.length < 1000) return sessions;
  }
}
