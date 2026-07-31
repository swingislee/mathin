import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "./finance";
import type { AttendanceStatus } from "./learning";
import type { AssignmentContent, SubmissionRecord } from "@/features/classroom/types";
import { isFeatureEnabled } from "./organization-settings";

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

export interface MyGuardianRelationship {
  isPrimary: boolean;
}

export async function getMyGuardianRelationship(studentId: string): Promise<MyGuardianRelationship | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("student_guardians")
    .select("is_primary")
    .eq("student_id", studentId)
    .eq("guardian_id", user.id)
    .maybeSingle<{ is_primary: boolean }>();
  if (error) throw new Error(error.message);
  return data ? { isPrimary: data.is_primary } : null;
}

export type PaymentStatus = "overdue" | "ok" | "none" | "closed";

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
  const financeEnabled = await isFeatureEnabled("finance.enabled").catch(() => false);
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
    paymentStatus: financeEnabled ? row.payment_status : "closed",
    weekSessionCount: row.week_session_count,
    pendingAssignmentCount: row.pending_assignment_count,
  }));
}

export type MyLearningCheckStatus = "explained" | "independent" | "prompted" | "imitated" | "incomplete";

export interface MyLearningCheckResult {
  checkId: string;
  sessionId: string;
  studentId: string;
  classroomId: string;
  classroomName: string;
  lectureName: string;
  scheduledAt: string | null;
  endedAt: string;
  position: number;
  checkTitle: string;
  status: MyLearningCheckStatus;
  markedAt: string;
}

export async function getMyLearningCheckResults(options: {
  classroomId?: string;
  fromIso?: string;
  toIso?: string;
} = {}): Promise<MyLearningCheckResult[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_learning_check_results", {
    p_classroom_id: options.classroomId,
    p_from: options.fromIso,
    p_to: options.toIso,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    checkId: row.check_id,
    sessionId: row.session_id,
    studentId: row.student_id,
    classroomId: row.classroom_id,
    classroomName: row.classroom_name,
    lectureName: row.lecture_name,
    scheduledAt: row.scheduled_at,
    endedAt: row.ended_at,
    position: row.check_position,
    checkTitle: row.check_title,
    status: row.status as MyLearningCheckStatus,
    markedAt: row.marked_at,
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
  studentId: string;
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
      student_id: string;
      student_name: string;
      classroom_name: string;
      lecture_name: string;
      scheduled_at: string;
      status: AttendanceStatus;
    }>
  ).map((row) => ({
    sessionId: row.session_id,
    studentId: row.student_id,
    studentName: row.student_name,
    classroomName: row.classroom_name,
    lectureName: row.lecture_name,
    scheduledAt: row.scheduled_at,
    status: row.status,
  }));
}

export interface MySessionReview{sessionId:string;studentId:string;studentName:string;classroomName:string;lectureName:string;scheduledAt:string;entryScore:number|null;exitScore:number|null;focus:number|null;participation:number|null;mastery:number|null;comment:string;knowledgeSummary:string}
export async function getMySessionReviews(fromIso:string,toIso:string):Promise<MySessionReview[]>{const s=await createClient();const{data,error}=await s.rpc("get_my_session_reviews",{p_from:fromIso,p_to:toIso});if(error)throw new Error(error.message);return((data??[])as Array<{session_id:string;student_id:string;student_name:string;classroom_name:string;lecture_name:string;scheduled_at:string;entry_score:number|null;exit_score:number|null;focus:number|null;participation:number|null;mastery:number|null;comment:string;knowledge_summary:string}>).map(x=>({sessionId:x.session_id,studentId:x.student_id,studentName:x.student_name,classroomName:x.classroom_name,lectureName:x.lecture_name,scheduledAt:x.scheduled_at,entryScore:x.entry_score,exitScore:x.exit_score,focus:x.focus,participation:x.participation,mastery:x.mastery,comment:x.comment,knowledgeSummary:x.knowledge_summary}))}
export type SessionReviewAvailability = "pending" | "published" | "withdrawn";
export interface MySessionReviewState {
  sessionId: string;
  studentId: string;
  studentName: string;
  classroomName: string;
  lectureName: string;
  scheduledAt: string;
  availabilityState: SessionReviewAvailability;
}
export async function getMySessionReviewStates(fromIso: string, toIso: string): Promise<MySessionReviewState[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_session_review_states", { p_from: fromIso, p_to: toIso });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{
    session_id: string;
    student_id: string;
    student_name: string;
    classroom_name: string;
    lecture_name: string;
    scheduled_at: string;
    availability_state: SessionReviewAvailability;
  }>).map((row) => ({
    sessionId: row.session_id,
    studentId: row.student_id,
    studentName: row.student_name,
    classroomName: row.classroom_name,
    lectureName: row.lecture_name,
    scheduledAt: row.scheduled_at,
    availabilityState: row.availability_state,
  }));
}
export async function getMyReviewedVideos():Promise<Array<{videoId:string;sessionId:string;studentId:string;score:number|null;comment:string}>>{const s=await createClient();const{data,error}=await s.rpc("get_my_reviewed_videos");if(error)throw new Error(error.message);return((data??[])as Array<{video_id:string;session_id:string;student_id:string;review_score:number|null;review_comment:string}>).map(x=>({videoId:x.video_id,sessionId:x.session_id,studentId:x.student_id,score:x.review_score,comment:x.review_comment}))}

export interface MyPendingAssignment {
  assignmentId: string;
  classroomId: string;
  classroomName: string;
  title: string;
  dueAt: string | null;
  studentId: string;
  studentName: string;
}

export async function getMyPendingAssignments(): Promise<MyPendingAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_pending_assignments");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    assignmentId: row.assignment_id,
    classroomId: row.classroom_id,
    classroomName: row.classroom_name,
    title: row.title,
    dueAt: row.due_at,
    studentId: row.student_id,
    studentName: row.student_name,
  }));
}
export interface CustomerAssignment {
  assignmentId: string;
  classroomId: string;
  classroomName: string;
  title: string;
  content: AssignmentContent;
  dueAt: string | null;
  studentId: string;
  studentName: string;
}

export async function getCustomerAssignment(assignmentId: string, studentId: string): Promise<{
  assignment: CustomerAssignment | null;
  submission: SubmissionRecord | null;
}> {
  const supabase = await createClient();
  const [assignmentResult, submissionResult] = await Promise.all([
    supabase.rpc("get_customer_assignment", { p_assignment_id: assignmentId, p_student_id: studentId }),
    supabase.rpc("get_customer_submission", { p_assignment_id: assignmentId, p_student_id: studentId }),
  ]);
  if (assignmentResult.error) throw new Error(assignmentResult.error.message);
  if (submissionResult.error) throw new Error(submissionResult.error.message);
  const row = assignmentResult.data?.[0];
  const submission = submissionResult.data?.[0];
  return {
    assignment: row ? {
      assignmentId: row.assignment_id,
      classroomId: row.classroom_id,
      classroomName: row.classroom_name,
      title: row.title,
      content: (row.content ?? { text: "" }) as unknown as AssignmentContent,
      dueAt: row.due_at,
      studentId: row.student_id,
      studentName: row.student_name,
    } : null,
    submission: submission ? {
      id: submission.id,
      userId: submission.user_id,
      displayName: row?.student_name ?? "",
      content: (submission.content ?? { text: "" }) as unknown as AssignmentContent,
      submittedAt: submission.submitted_at,
      score: submission.score,
      feedback: submission.feedback,
      gradedAt: submission.graded_at,
    } : null,
  };
}

export interface MyLeaveRequest {
  id: string;
  sessionId: string;
  sessionTitle: string;
  studentId: string;
  studentName: string;
  reason: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  makeupSessionId: string | null;
  makeupSessionTitle: string | null;
  makeupClassroomName: string | null;
  makeupScheduledAt: string | null;
  makeupStatus: "to_schedule" | "scheduled" | "completed" | "cancelled" | null;
}

export async function listMySessionLeaveRequests(): Promise<MyLeaveRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_session_leave_requests");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    studentId: row.student_id,
    studentName: row.student_name,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    makeupSessionId: row.makeup_session_id,
    makeupSessionTitle: row.makeup_session_title,
    makeupClassroomName: row.makeup_classroom_name,
    makeupScheduledAt: row.makeup_scheduled_at,
    makeupStatus: row.makeup_status as MyLeaveRequest["makeupStatus"],
  }));
}

export interface MyPublishedVideoTask {
  videoTaskId: string;
  sessionId: string;
  classroomId: string;
  classroomName: string;
  lectureName: string;
  title: string;
  instructions: string;
  dueAt: string | null;
  studentId: string;
  studentName: string;
  submitted: boolean;
}

export async function getMyPublishedVideoTasks(): Promise<MyPublishedVideoTask[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_published_video_tasks");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    videoTaskId: row.video_task_id,
    sessionId: row.session_id,
    classroomId: row.classroom_id,
    classroomName: row.classroom_name,
    lectureName: row.lecture_name,
    title: row.title,
    instructions: row.instructions,
    dueAt: row.due_at,
    studentId: row.student_id,
    studentName: row.student_name,
    submitted: row.submitted,
  }));
}
