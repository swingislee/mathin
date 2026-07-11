import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "./finance";
import type { AttendanceStatus } from "./learning";

// ---------------------------------------------------------------------------
// 顾客侧（学生/家长）首屏数据层（10-§7，P4B-8）。全部经白名单 RPC 或既有
// classroom_members/assignments/submissions 的自读 RLS 取数，永不直读内部表。
// ---------------------------------------------------------------------------

export interface MyStudentRow {
  id: string;
  name: string;
  grade: number | null;
  status: string;
}

export async function getMyStudents(): Promise<MyStudentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_students");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; name: string; grade: number | null; status: string }>).map((row) => ({
    id: row.id,
    name: row.name,
    grade: row.grade,
    status: row.status,
  }));
}

export type PaymentStatus = "overdue" | "ok" | "none";

export interface MyLearningSummary {
  studentId: string;
  studentName: string;
  grade: number | null;
  nextSessionAt: string | null;
  attendanceRate30d: number | null;
  recentSubmissions: Array<{ title: string; score: number | null; gradedAt: string | null }>;
  starTotal: number;
  paymentStatus: PaymentStatus;
  /** 未来 7 天课次数（P4C-7；时刻展示串由调用方从课表拼）。 */
  weekSessionCount: number;
  /** 未交且未过期作业数；孩子无账号时为 null（显示"—"，不是 0）。 */
  pendingAssignmentCount: number | null;
}

export async function getMyLearningSummary(): Promise<MyLearningSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_learning_summary");
  if (error) throw new Error(error.message);
  return (
    (data ?? []) as Array<{
      student_id: string;
      student_name: string;
      grade: number | null;
      next_session_at: string | null;
      attendance_rate_30d: number | null;
      recent_submissions: Array<{ title: string; score: number | null; gradedAt: string | null }>;
      star_total: number;
      payment_status: PaymentStatus;
      week_session_count: number;
      pending_assignment_count: number | null;
    }>
  ).map((row) => ({
    studentId: row.student_id,
    studentName: row.student_name,
    grade: row.grade,
    nextSessionAt: row.next_session_at,
    attendanceRate30d: row.attendance_rate_30d,
    recentSubmissions: row.recent_submissions ?? [],
    starTotal: row.star_total,
    paymentStatus: row.payment_status,
    weekSessionCount: row.week_session_count,
    pendingAssignmentCount: row.pending_assignment_count,
  }));
}

export interface MyOrderRow {
  orderId: string;
  orderNo: string;
  classroomName: string | null;
  kind: string;
  amountDue: number;
  status: OrderStatus;
  createdAt: string;
  paidTotal: number;
}

export async function getMyOrders(): Promise<MyOrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_orders");
  if (error) throw new Error(error.message);
  return (
    (data ?? []) as Array<{
      order_id: string;
      order_no: string;
      classroom_name: string | null;
      kind: string;
      amount_due: number;
      status: OrderStatus;
      created_at: string;
      paid_total: number;
    }>
  ).map((row) => ({
    orderId: row.order_id,
    orderNo: row.order_no,
    classroomName: row.classroom_name,
    kind: row.kind,
    amountDue: row.amount_due,
    status: row.status,
    createdAt: row.created_at,
    paidTotal: row.paid_total,
  }));
}

export interface MyAccountRow {
  studentId: string;
  studentName: string;
  balance: number;
}

export async function getMyAccounts(): Promise<MyAccountRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_account");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ student_id: string; student_name: string; balance: number }>).map((row) => ({
    studentId: row.student_id,
    studentName: row.student_name,
    balance: row.balance,
  }));
}

export interface MyAttendanceRow {
  sessionId: string;
  studentName: string;
  classroomName: string;
  lectureName: string;
  scheduledAt: string;
  status: AttendanceStatus;
}

export async function getMyAttendance(fromIso: string, toIso: string): Promise<MyAttendanceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_attendance", { p_from: fromIso, p_to: toIso });
  if (error) throw new Error(error.message);
  return (
    (data ?? []) as Array<{
      session_id: string;
      student_name: string;
      classroom_name: string;
      lecture_name: string;
      scheduled_at: string;
      status: AttendanceStatus;
    }>
  ).map((row) => ({
    sessionId: row.session_id,
    studentName: row.student_name,
    classroomName: row.classroom_name,
    lectureName: row.lecture_name,
    scheduledAt: row.scheduled_at,
    status: row.status,
  }));
}

export interface MyPendingAssignment {
  assignmentId: string;
  classroomId: string;
  classroomName: string;
  title: string;
  dueAt: string | null;
}

export async function getMyPendingAssignments(): Promise<MyPendingAssignment[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: memberRows, error: memberError } = await supabase
    .from("classroom_members")
    .select("classroom_id,classrooms(name)")
    .eq("user_id", user.id)
    .eq("role", "student")
    .returns<Array<{ classroom_id: string; classrooms: { name: string } | null }>>();
  if (memberError) throw new Error(memberError.message);
  const classroomIds = (memberRows ?? []).map((row) => row.classroom_id);
  if (classroomIds.length === 0) return [];
  const classroomNameById = new Map((memberRows ?? []).map((row) => [row.classroom_id, row.classrooms?.name || "-"]));

  const [{ data: assignmentRows, error: assignmentError }, { data: submissionRows, error: submissionError }] = await Promise.all([
    supabase
      .from("assignments")
      .select("id,classroom_id,title,due_at")
      .in("classroom_id", classroomIds)
      .order("due_at", { ascending: true, nullsFirst: false })
      .returns<Array<{ id: string; classroom_id: string; title: string; due_at: string | null }>>(),
    supabase
      .from("submissions")
      .select("assignment_id")
      .eq("user_id", user.id)
      .not("submitted_at", "is", null)
      .returns<Array<{ assignment_id: string }>>(),
  ]);
  if (assignmentError) throw new Error(assignmentError.message);
  if (submissionError) throw new Error(submissionError.message);
  const submittedIds = new Set((submissionRows ?? []).map((row) => row.assignment_id));

  return (assignmentRows ?? [])
    .filter((row) => !submittedIds.has(row.id))
    .map((row) => ({
      assignmentId: row.id,
      classroomId: row.classroom_id,
      classroomName: classroomNameById.get(row.classroom_id) || "-",
      title: row.title,
      dueAt: row.due_at,
    }));
}
