import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FOLLOW_UP_STATUSES, type FollowUpStatus } from "./students";
import { addDays, startOfDay, startOfMonth, startOfWeek } from "./schedule";

// ---------------------------------------------------------------------------
// staff 工作台卡片池数据层（10-§7，P4B-7）。每个函数对应一张卡的查询，
// 页面按 requiredPerm 决定是否调用；调用失败由页面逐卡 try/catch 落空态，
// 这里不重复做权限判断（RLS 兜底 + 页面层已按 hasPerm 决定是否查询）。
// ---------------------------------------------------------------------------

export interface StaffStats {
  enrolledCount: number;
  leadCount: number;
  weekSessionCount: number;
  overdueFollowUpCount: number;
}

export async function getStaffStats(): Promise<StaffStats> {
  const supabase = await createClient();
  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = addDays(weekStart, 7);
  const [enrolled, leads, sessions, overdue] = await Promise.all([
    supabase.from("students").select("*", { count: "exact", head: true }).eq("status", "enrolled"),
    supabase.from("students").select("*", { count: "exact", head: true }).in("status", ["lead", "trialing"]),
    supabase
      .from("class_sessions")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("scheduled_at", weekStart.toISOString())
      .lt("scheduled_at", weekEnd.toISOString()),
    supabase.from("students").select("*", { count: "exact", head: true }).lt("next_follow_up_at", now.toISOString()),
  ]);
  return {
    enrolledCount: enrolled.count ?? 0,
    leadCount: leads.count ?? 0,
    weekSessionCount: sessions.count ?? 0,
    overdueFollowUpCount: overdue.count ?? 0,
  };
}

export interface TodaySessionRow {
  sessionId: string;
  classroomId: string;
  classroomName: string;
  title: string;
  scheduledAt: string;
  teacherName: string;
}

export async function getTodaySchedule(): Promise<TodaySessionRow[]> {
  const supabase = await createClient();
  const now = new Date();
  const from = startOfDay(now);
  const to = addDays(from, 1);
  const { data: sessionRows, error } = await supabase
    .from("class_sessions")
    .select("id,title,scheduled_at,classroom_id,classrooms(name)")
    .is("deleted_at", null)
    .gte("scheduled_at", from.toISOString())
    .lt("scheduled_at", to.toISOString())
    .order("scheduled_at", { ascending: true })
    .returns<Array<{ id: string; title: string; scheduled_at: string; classroom_id: string; classrooms: { name: string } | null }>>();
  if (error) throw new Error(error.message);
  const rows = sessionRows ?? [];
  if (rows.length === 0) return [];

  const classroomIds = Array.from(new Set(rows.map((row) => row.classroom_id)));
  const { data: teacherRows, error: teacherError } = await supabase
    .from("classroom_members")
    .select("classroom_id,profiles(display_name)")
    .in("classroom_id", classroomIds)
    .eq("role", "teacher")
    .returns<Array<{ classroom_id: string; profiles: { display_name: string } | null }>>();
  if (teacherError) throw new Error(teacherError.message);
  const teacherByClassroom = new Map<string, string>();
  for (const row of teacherRows ?? []) {
    if (!teacherByClassroom.has(row.classroom_id) && row.profiles?.display_name) {
      teacherByClassroom.set(row.classroom_id, row.profiles.display_name);
    }
  }

  return rows.map((row) => ({
    sessionId: row.id,
    classroomId: row.classroom_id,
    classroomName: row.classrooms?.name || "-",
    title: row.title,
    scheduledAt: row.scheduled_at,
    teacherName: teacherByClassroom.get(row.classroom_id) || "",
  }));
}

export interface FollowUpFunnelBucket {
  status: FollowUpStatus;
  count: number;
}

export async function getFollowUpFunnel(): Promise<FollowUpFunnelBucket[]> {
  const supabase = await createClient();
  const results = await Promise.all(
    FOLLOW_UP_STATUSES.map((status) => supabase.from("students").select("*", { count: "exact", head: true }).eq("follow_up_status", status)),
  );
  return FOLLOW_UP_STATUSES.map((status, i) => ({ status, count: results[i].count ?? 0 }));
}

export interface MyOverdueFollowUp {
  studentId: string;
  studentName: string;
  followUpStatus: FollowUpStatus;
  nextFollowUpAt: string;
}

export async function getMyOverdueFollowUps(uid: string): Promise<MyOverdueFollowUp[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .select("id,name,follow_up_status,next_follow_up_at")
    .eq("assigned_to", uid)
    .lt("next_follow_up_at", new Date().toISOString())
    .order("next_follow_up_at", { ascending: true })
    .limit(8)
    .returns<Array<{ id: string; name: string; follow_up_status: FollowUpStatus; next_follow_up_at: string }>>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    studentId: row.id,
    studentName: row.name,
    followUpStatus: row.follow_up_status,
    nextFollowUpAt: row.next_follow_up_at,
  }));
}

export interface MyPerformance {
  dueTotal: number;
  paidTotal: number;
  enrollCount: number;
}

export async function getMyMonthlyPerformance(uid: string): Promise<MyPerformance> {
  const supabase = await createClient();
  const monthStart = startOfMonth(new Date());
  const { data, error } = await supabase
    .from("orders")
    .select("kind,amount_due,payments(amount)")
    .eq("created_by", uid)
    .gte("created_at", monthStart.toISOString())
    .returns<Array<{ kind: string; amount_due: number; payments: Array<{ amount: number }> }>>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return {
    dueTotal: rows.reduce((sum, row) => sum + row.amount_due, 0),
    paidTotal: rows.reduce((sum, row) => sum + (row.payments ?? []).reduce((s, p) => s + p.amount, 0), 0),
    enrollCount: rows.filter((row) => row.kind === "enroll").length,
  };
}

async function getMyTeacherClassroomIds(supabase: SupabaseClient, uid: string): Promise<string[]> {
  const { data, error } = await supabase.from("classroom_members").select("classroom_id").eq("user_id", uid).eq("role", "teacher");
  if (error) throw new Error(error.message);
  return Array.from(new Set((data ?? []).map((row: { classroom_id: string }) => row.classroom_id)));
}

export interface MyTeachingSession {
  sessionId: string;
  classroomId: string;
  classroomName: string;
  title: string;
  scheduledAt: string;
  isToday: boolean;
  unprepared: boolean;
}

export interface MyTeachingCard {
  sessions: MyTeachingSession[];
  pendingGradingCount: number;
}

export async function getMyTeachingCard(uid: string): Promise<MyTeachingCard> {
  const supabase = await createClient();
  const classroomIds = await getMyTeacherClassroomIds(supabase, uid);
  if (classroomIds.length === 0) return { sessions: [], pendingGradingCount: 0 };

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = addDays(todayStart, 1);
  const weekEnd = addDays(startOfWeek(now), 7);

  const [{ data: sessionRows, error: sessionError }, { data: assignmentRows, error: assignmentError }] = await Promise.all([
    supabase
      .from("class_sessions")
      .select("id,title,scheduled_at,classroom_id,courseware_overlay,classrooms(name)")
      .in("classroom_id", classroomIds)
      .is("deleted_at", null)
      .gte("scheduled_at", todayStart.toISOString())
      .lt("scheduled_at", weekEnd.toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(12)
      .returns<Array<{ id: string; title: string; scheduled_at: string; classroom_id: string; courseware_overlay: unknown[]; classrooms: { name: string } | null }>>(),
    supabase.from("assignments").select("id").in("classroom_id", classroomIds).returns<Array<{ id: string }>>(),
  ]);
  if (sessionError) throw new Error(sessionError.message);
  if (assignmentError) throw new Error(assignmentError.message);

  let pendingGradingCount = 0;
  const assignmentIds = (assignmentRows ?? []).map((row) => row.id);
  if (assignmentIds.length > 0) {
    const { count, error: submissionError } = await supabase
      .from("submissions")
      .select("*", { count: "exact", head: true })
      .in("assignment_id", assignmentIds)
      .is("graded_at", null)
      .not("submitted_at", "is", null);
    if (submissionError) throw new Error(submissionError.message);
    pendingGradingCount = count ?? 0;
  }

  return {
    sessions: (sessionRows ?? []).map((row) => ({
      sessionId: row.id,
      classroomId: row.classroom_id,
      classroomName: row.classrooms?.name || "-",
      title: row.title,
      scheduledAt: row.scheduled_at,
      isToday: row.scheduled_at < todayEnd.toISOString(),
      unprepared: (row.courseware_overlay?.length ?? 0) === 0,
    })),
    pendingGradingCount,
  };
}

export interface MyClassroomCard {
  id: string;
  name: string;
  activeCount: number;
  capacity: number | null;
  doneSessionCount: number;
  totalSessionCount: number;
}

export async function getMyClassroomCards(uid: string): Promise<MyClassroomCard[]> {
  const supabase = await createClient();
  const classroomIds = await getMyTeacherClassroomIds(supabase, uid);
  if (classroomIds.length === 0) return [];
  const { data, error } = await supabase
    .from("classrooms")
    .select("id,name,capacity,archived_at,enrollments!enrollments_classroom_id_fkey(status),class_sessions!class_sessions_classroom_id_fkey(started_at,ended_at)")
    .in("id", classroomIds)
    .is("archived_at", null)
    .is("class_sessions.deleted_at", null)
    .returns<
      Array<{
        id: string;
        name: string;
        capacity: number | null;
        enrollments: Array<{ status: string }>;
        class_sessions: Array<{ started_at: string | null; ended_at: string | null }>;
      }>
    >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name || "-",
    activeCount: (row.enrollments ?? []).filter((e) => e.status === "active").length,
    capacity: row.capacity,
    doneSessionCount: (row.class_sessions ?? []).filter((s) => s.ended_at).length,
    totalSessionCount: (row.class_sessions ?? []).length,
  }));
}

export interface FinanceOverview {
  dueTotal: number;
  paidTotal: number;
  refundTotal: number;
  overdueOrderCount: number;
}

export async function getFinanceOverview(): Promise<FinanceOverview> {
  const supabase = await createClient();
  const monthStart = startOfMonth(new Date());
  const [dueRes, paidRes, refundRes, overdueRes] = await Promise.all([
    supabase.from("orders").select("amount_due").gte("created_at", monthStart.toISOString()).returns<Array<{ amount_due: number }>>(),
    supabase.from("payments").select("amount").gte("paid_at", monthStart.toISOString()).returns<Array<{ amount: number }>>(),
    supabase
      .from("refunds")
      .select("amount")
      .eq("status", "done")
      .gte("approved_at", monthStart.toISOString())
      .returns<Array<{ amount: number }>>(),
    supabase.from("orders").select("*", { count: "exact", head: true }).in("status", ["unpaid", "partial"]),
  ]);
  if (dueRes.error) throw new Error(dueRes.error.message);
  if (paidRes.error) throw new Error(paidRes.error.message);
  if (refundRes.error) throw new Error(refundRes.error.message);
  if (overdueRes.error) throw new Error(overdueRes.error.message);
  return {
    dueTotal: (dueRes.data ?? []).reduce((sum, row) => sum + row.amount_due, 0),
    paidTotal: (paidRes.data ?? []).reduce((sum, row) => sum + row.amount, 0),
    refundTotal: (refundRes.data ?? []).reduce((sum, row) => sum + row.amount, 0),
    overdueOrderCount: overdueRes.count ?? 0,
  };
}
