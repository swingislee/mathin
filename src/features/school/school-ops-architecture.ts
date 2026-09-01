import { createClient } from "@/lib/supabase/server";

export interface SchoolOpsArchitectureSnapshot {
  importBatches: number | null;
  leadStudents: number | null;
  dueFollowUps: number | null;
  activities: number | null;
  activeClassMemberships: number | null;
  sessions: number | null;
  attendanceRecords: number | null;
}

type CountResult = {
  count: number | null;
  error: { message: string } | null;
};

function visibleCount(result: CountResult): number | null {
  return result.error ? null : (result.count ?? 0);
}

/**
 * Phase 0 只读快照。
 *
 * 每个 count 都继续服从当前账号的 RLS；页面展示的是“当前账号可见事实”，不是全机构
 * 绕权统计。某个旧领域尚未给当前角色读权限时返回 null，让审阅页明确显示不可读，
 * 不用 service client 绕过边界，也不把查询失败伪装成 0。
 */
export async function getSchoolOpsArchitectureSnapshot(): Promise<SchoolOpsArchitectureSnapshot> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const [
    importBatches,
    leadStudents,
    dueFollowUps,
    activities,
    activeClassMemberships,
    sessions,
    attendanceRecords,
  ] = await Promise.all([
    supabase.from("data_import_batches").select("id", { count: "exact", head: true }),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .in("status", ["lead", "trialing"]),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .not("next_follow_up_at", "is", null)
      .lte("next_follow_up_at", now),
    supabase
      .from("activities")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null),
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("class_sessions")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null),
    supabase.from("session_attendance").select("session_id", { count: "exact", head: true }),
  ]);

  return {
    importBatches: visibleCount(importBatches),
    leadStudents: visibleCount(leadStudents),
    dueFollowUps: visibleCount(dueFollowUps),
    activities: visibleCount(activities),
    activeClassMemberships: visibleCount(activeClassMemberships),
    sessions: visibleCount(sessions),
    attendanceRecords: visibleCount(attendanceRecords),
  };
}
