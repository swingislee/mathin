import { createClient } from "@/lib/supabase/server";
import { FOLLOW_UP_STATUSES, type FollowUpStatus } from "./students";
import { addDays, startOfMonth, startOfWeek } from "./schedule";

// ---------------------------------------------------------------------------
// 领域概览页数据层（10-§7，P4B-7；P4I-19 收口：staff 磁贴池随 StaffHome 一起
// 退休后，只保留仍被 students/finance/courses/operations 概览页复用的查询）。
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
    supabase.from("students").select("*", { count: "exact", head: true }).is("deleted_at", null).eq("status", "enrolled"),
    supabase.from("students").select("*", { count: "exact", head: true }).is("deleted_at", null).in("status", ["lead", "trialing"]),
    supabase
      .from("class_sessions")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("scheduled_at", weekStart.toISOString())
      .lt("scheduled_at", weekEnd.toISOString()),
    supabase.from("students").select("*", { count: "exact", head: true }).is("deleted_at", null).lt("next_follow_up_at", now.toISOString()),
  ]);
  return {
    enrolledCount: enrolled.count ?? 0,
    leadCount: leads.count ?? 0,
    weekSessionCount: sessions.count ?? 0,
    overdueFollowUpCount: overdue.count ?? 0,
  };
}

export interface FollowUpFunnelBucket {
  status: FollowUpStatus;
  count: number;
}

export async function getFollowUpFunnel(): Promise<FollowUpFunnelBucket[]> {
  const supabase = await createClient();
  const results = await Promise.all(
    FOLLOW_UP_STATUSES.map((status) => supabase.from("students").select("*", { count: "exact", head: true }).is("deleted_at", null).eq("follow_up_status", status)),
  );
  return FOLLOW_UP_STATUSES.map((status, i) => ({ status, count: results[i].count ?? 0 }));
}

export interface TemplateProgressRow {
  grade: number;
  ready: number;
  total: number;
}

/** 课件模板完成度：按年级分行（教研 templateProgress 贴）。两次轻量行查询内存分组，不拉模板 jsonb。 */
export async function getTemplateProgress(): Promise<TemplateProgressRow[]> {
  const supabase = await createClient();
  const [totalRes, readyRes] = await Promise.all([
    supabase.from("course_lectures").select("courses!inner(grade)").limit(10000).returns<Array<{ courses: { grade: number } }>>(),
    supabase
      .from("course_lectures")
      .select("courses!inner(grade)")
      .neq("courseware_template", "[]")
      .limit(10000)
      .returns<Array<{ courses: { grade: number } }>>(),
  ]);
  if (totalRes.error) throw new Error(totalRes.error.message);
  if (readyRes.error) throw new Error(readyRes.error.message);
  const rows = new Map<number, TemplateProgressRow>();
  for (const row of totalRes.data ?? []) {
    const entry = rows.get(row.courses.grade) ?? { grade: row.courses.grade, ready: 0, total: 0 };
    entry.total += 1;
    rows.set(row.courses.grade, entry);
  }
  for (const row of readyRes.data ?? []) {
    const entry = rows.get(row.courses.grade);
    if (entry) entry.ready += 1;
  }
  return Array.from(rows.values()).sort((a, b) => a.grade - b.grade);
}

export interface RosterMismatch {
  /** active 报名但学生无账号，或账号不在该教室成员里。 */
  unlinkedEnrollments: number;
  /** 教室 student 成员没有对应 active 报名（只统计带 course_id 的教学班，排除自由教室）。 */
  orphanMembers: number;
}

/** 花名册错位全局对账（§0.2）：两个全量数组内存对账，禁按班级循环 N+1。 */
export async function getRosterMismatchCount(): Promise<RosterMismatch> {
  const supabase = await createClient();
  const [enrollRes, memberRes] = await Promise.all([
    supabase
      .from("enrollments")
      .select("classroom_id,student_id,students!inner(user_id)")
      .is("students.deleted_at", null)
      .eq("status", "active")
      .limit(5000)
      .returns<Array<{ classroom_id: string; student_id: string; students: { user_id: string | null } | null }>>(),
    supabase
      .from("classroom_members")
      .select("classroom_id,user_id,classrooms!inner(course_id)")
      .eq("role", "student")
      .not("classrooms.course_id", "is", null)
      .limit(5000)
      .returns<Array<{ classroom_id: string; user_id: string }>>(),
  ]);
  if (enrollRes.error) throw new Error(enrollRes.error.message);
  if (memberRes.error) throw new Error(memberRes.error.message);
  const enrollments = enrollRes.data ?? [];
  const members = memberRes.data ?? [];

  const memberSet = new Set(members.map((row) => `${row.classroom_id}:${row.user_id}`));
  const enrolledSet = new Set(
    enrollments.filter((row) => row.students?.user_id).map((row) => `${row.classroom_id}:${row.students!.user_id}`),
  );
  return {
    unlinkedEnrollments: enrollments.filter(
      (row) => !row.students?.user_id || !memberSet.has(`${row.classroom_id}:${row.students.user_id}`),
    ).length,
    orphanMembers: members.filter((row) => !enrolledSet.has(`${row.classroom_id}:${row.user_id}`)).length,
  };
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
