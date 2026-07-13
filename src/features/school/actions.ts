"use server";

import { getMyPerms, getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isPermissionKey, type PermissionKey } from "./permissions";
import {
  courseware_template_array_schema,
  initialOverlayFromTemplate,
  overlayArraySchema,
  parseOverlayForSave,
  type CoursewareTemplatePage,
  type OverlaySlot,
} from "./courseware-overlay";
import { getStudentAccount, listAvailableCouponGrants } from "./finance";
import type { CouponGrantOption, CouponKind, PaymentMethod, ScholarshipKind, StudentAccount } from "./finance";
import type { AttendanceStatus } from "./learning";
import type { ScheduleEntry } from "./schedule";
import { FOLLOW_UP_STATUSES, STUDENT_STATUSES, type StudentStatus } from "./students";
import type { ActionResult } from "@/lib/action-result";

/** 校验闸：登录 + 功能权限键（两道闸的第二道，第一道靠 requirePerm 挡在页面级；RLS 第三道兜底）。 */
async function authorizedClient(key: PermissionKey) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const perms = await getMyPerms(user.id);
  if (!perms.has(key)) throw new Error("FORBIDDEN");
  return { supabase, user };
}

// ---------------------------------------------------------------------------
// 课件模板（P4B-3 §4.3）
// ---------------------------------------------------------------------------

export async function updateLectureTemplate(lectureId: string, pages: CoursewareTemplatePage[]): Promise<void> {
  const parsed = courseware_template_array_schema.safeParse(pages);
  if (!parsed.success) throw new Error("INVALID_TEMPLATE");
  const { supabase } = await authorizedClient("courseware.template.edit");
  const { error } = await supabase
    .from("course_lectures")
    .update({ courseware_template: parsed.data })
    .eq("id", lectureId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 课次覆盖层（P4B-3 §4.3）：教师只能插页/排序，服务端 resolve 校验禁止删改模板页。
// ---------------------------------------------------------------------------

export async function saveCoursewareOverlay(sessionId: string, overlay: OverlaySlot[]): Promise<void> {
  const shapeCheck = overlayArraySchema.safeParse(overlay);
  if (!shapeCheck.success) throw new Error("INVALID_OVERLAY");
  const { supabase } = await authorizedClient("courseware.overlay.edit");

  const { data: session, error: sessionError } = await supabase
    .from("class_sessions")
    .select("lecture_id,courseware_frozen_at")
    .eq("id", sessionId)
    .maybeSingle<{ lecture_id: string | null; courseware_frozen_at: string | null }>();
  if (sessionError) throw new Error(sessionError.message);
  if (!session) throw new Error("NOT_FOUND");
  if (session.courseware_frozen_at) throw new Error("ALREADY_FROZEN");
  if (!session.lecture_id) throw new Error("NO_LECTURE");

  const { data: lecture, error: lectureError } = await supabase
    .from("course_lectures")
    .select("courseware_template")
    .eq("id", session.lecture_id)
    .maybeSingle<{ courseware_template: CoursewareTemplatePage[] }>();
  if (lectureError) throw new Error(lectureError.message);
  if (!lecture) throw new Error("NOT_FOUND");

  const healed = parseOverlayForSave(lecture.courseware_template ?? [], shapeCheck.data);
  const { error } = await supabase
    .from("class_sessions")
    .update({ courseware_overlay: healed })
    .eq("id", sessionId)
    .is("courseware_frozen_at", null);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 建班向导（P4B-3 §9）
// ---------------------------------------------------------------------------

export interface BuildClassSession {
  lectureId: string;
  no: number;
  name: string;
  scheduledAt: string;
  durationMin: number;
}

export interface BuildClassInput {
  name: string;
  courseId: string | null;
  grade: number | null;
  capacity: number | null;
  room: string;
  teacherId: string;
  sessions: BuildClassSession[];
}

export async function buildClass(input: BuildClassInput): Promise<string> {
  const { supabase } = await authorizedClient("class.create");

  const { data: cid, error: rpcError } = await supabase.rpc("create_class", {
    p_name: input.name.trim().slice(0, 100),
    p_course_id: input.courseId,
    p_grade: input.grade,
    p_capacity: input.capacity,
    p_room: input.room.trim().slice(0, 100),
    p_teacher_id: input.teacherId,
  });
  if (rpcError) throw new Error(rpcError.message);
  const classroomId = cid as string;

  if (input.sessions.length === 0) return classroomId;

  const lectureIds = input.sessions.map((session) => session.lectureId);
  const { data: lectureRows, error: lectureError } = await supabase
    .from("course_lectures")
    .select("id,courseware_template")
    .in("id", lectureIds)
    .returns<Array<{ id: string; courseware_template: CoursewareTemplatePage[] }>>();
  if (lectureError) throw new Error(lectureError.message);
  const templateById = new Map((lectureRows ?? []).map((row) => [row.id, row.courseware_template ?? []]));

  const rows = input.sessions.map((session) => ({
    classroom_id: classroomId,
    lecture_id: session.lectureId,
    lecture_no: session.no,
    title: session.name.slice(0, 100),
    scheduled_at: session.scheduledAt,
    duration_min: session.durationMin,
    courseware: [],
    courseware_overlay: initialOverlayFromTemplate(templateById.get(session.lectureId) ?? []),
  }));

  const { error: insertError } = await supabase.from("class_sessions").insert(rows);
  if (insertError) throw new Error(insertError.message);

  return classroomId;
}

// ---------------------------------------------------------------------------
// 报名 / 转班 / 退班（P4B-3 §9，跨表事实一律 RPC，Server Action 只透传+权限双闸）
// ---------------------------------------------------------------------------

export async function enrollStudentAction(classroomId: string, studentId: string, remark: string): Promise<void> {
  const { supabase } = await authorizedClient("enrollment.manage");
  const { error } = await supabase.rpc("enroll_student", {
    p_classroom_id: classroomId,
    p_student_id: studentId,
    p_remark: remark.slice(0, 500),
  });
  if (error) throw new Error(error.message);
}

export async function transferStudentAction(
  studentId: string,
  fromClassroomId: string,
  toClassroomId: string,
  remark: string,
): Promise<void> {
  const { supabase } = await authorizedClient("enrollment.manage");
  const { error } = await supabase.rpc("transfer_student", {
    p_student_id: studentId,
    p_from_classroom: fromClassroomId,
    p_to_classroom: toClassroomId,
    p_remark: remark.slice(0, 500),
  });
  if (error) throw new Error(error.message);
}

export async function withdrawStudentAction(enrollmentId: string, remark: string): Promise<void> {
  const { supabase } = await authorizedClient("enrollment.manage");
  const { error } = await supabase.rpc("withdraw_student", {
    p_enrollment_id: enrollmentId,
    p_remark: remark.slice(0, 500),
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 课次改时间 / 补排 / 删未上课次（同边界 CRUD，走 RLS 的 can_manage_classroom）
// ---------------------------------------------------------------------------

// class.manage 只是全局功能闸；行级作用域（本人任教 vs 全局）靠 RLS 收窄。
// 跨作用域操作时 RLS 会让 update/delete 静默命中 0 行而不报错，前端会误以为成功——
// 这里额外 select 受影响行数，0 行时改抛 FORBIDDEN_SCOPE（10-§7 代码审查发现）。

export async function rescheduleSessionAction(sessionId: string, scheduledAt: string, durationMin: number): Promise<void> {
  const { supabase } = await authorizedClient("class.manage");
  const { data, error } = await supabase
    .from("class_sessions")
    .update({ scheduled_at: scheduledAt, duration_min: durationMin })
    .eq("id", sessionId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("FORBIDDEN_SCOPE");
}

export async function assignSessionSubstituteAction(sessionId: string, teacherId: string | null, reason: string): Promise<void> {
  const { supabase } = await authorizedClient("class.manage");
  const { error } = await supabase.rpc("assign_session_substitute", {
    p_session_id: sessionId,
    p_teacher_id: teacherId,
    p_reason: reason.trim().slice(0, 1000),
  });
  if (error) throw new Error(error.message);
}

export async function listSubstituteTeachersAction(sessionId: string): Promise<Array<{ id: string; name: string }>> {
  const { supabase } = await authorizedClient("class.manage");
  const { data, error } = await supabase.rpc("list_substitute_candidates", { p_session_id: sessionId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; display_name: string }>).map((row) => ({ id: row.id, name: row.display_name }));
}

// 软删（P4C-2 §7）：不物理 delete，置 deleted_at；未开始且未删的课次才可删。
// 0 行命中同样抛 FORBIDDEN_SCOPE（RLS 跨作用域静默命中 0 行的老坑）。
export async function deleteUnstartedSessionAction(sessionId: string): Promise<void> {
  const { supabase } = await authorizedClient("class.manage");
  const { data, error } = await supabase
    .from("class_sessions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("started_at", null)
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("FORBIDDEN_SCOPE");
}

export async function restoreSessionAction(sessionId: string): Promise<void> {
  const { supabase } = await authorizedClient("class.manage");
  const { data, error } = await supabase
    .from("class_sessions")
    .update({ deleted_at: null })
    .eq("id", sessionId)
    .not("deleted_at", "is", null)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("FORBIDDEN_SCOPE");
}

export async function archiveClassroomAction(classroomId: string, archived: boolean): Promise<void> {
  const { supabase } = await authorizedClient("class.manage");
  const { data, error } = await supabase
    .from("classrooms")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", classroomId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("FORBIDDEN_SCOPE");
}

// ---------------------------------------------------------------------------
// 花名册辅助：报名对话框的学生搜索、转班对话框的目标班级下拉
// ---------------------------------------------------------------------------

export interface StudentSearchResult {
  id: string;
  name: string;
  grade: number | null;
  status: string;
}

export async function searchStudentsForEnroll(query: string): Promise<StudentSearchResult[]> {
  const { supabase } = await authorizedClient("enrollment.manage");
  const trimmed = query.trim().slice(0, 80);
  if (!trimmed) return [];
  const escaped = trimmed.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const { data, error } = await supabase
    .from("students")
    .select("id,name,grade,status")
    .is("deleted_at", null)
    .ilike("name", `%${escaped}%`)
    .limit(10)
    .returns<StudentSearchResult[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listClassroomOptions(excludeId?: string): Promise<Array<{ id: string; name: string }>> {
  const { supabase } = await authorizedClient("enrollment.manage");
  let query = supabase.from("classrooms").select("id,name").is("archived_at", null).order("name", { ascending: true }).limit(200);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query.returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, name: row.name || "-" }));
}

// ---------------------------------------------------------------------------
// 课表（P4B-4）：student/parent 经白名单 RPC；staff 直查表，RLS 按
// schedule.view.all（全校）或本人任教（otherwise）自然收窄，教师名在此合并进结果。
// ---------------------------------------------------------------------------

interface MySchedRow {
  session_id: string;
  classroom_id: string;
  classroom_name: string;
  lecture_name: string;
  scheduled_at: string;
  duration_min: number | null;
  teacher_name: string | null;
  student_name: string | null;
}

interface StaffSessionRow {
  id: string;
  title: string;
  scheduled_at: string;
  duration_min: number | null;
  classroom_id: string;
  classrooms: { name: string } | null;
}

export async function getWeekSchedule(fromIso: string, toIso: string): Promise<ScheduleEntry[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const profile = await getProfile(user.id);
  if (!profile) return [];

  if (profile.role === "student" || profile.role === "parent") {
    const { data, error } = await supabase.rpc("get_my_schedule", { p_from: fromIso, p_to: toIso });
    if (error) throw new Error(error.message);
    return ((data ?? []) as MySchedRow[]).map((row) => ({
      sessionId: row.session_id,
      classroomId: row.classroom_id,
      classroomName: row.classroom_name,
      lectureName: row.lecture_name,
      scheduledAt: row.scheduled_at,
      durationMin: row.duration_min ?? 0,
      teacherName: row.teacher_name ?? "",
      studentName: row.student_name ?? "",
    }));
  }

  const { data: sessionRows, error } = await supabase
    .from("class_sessions")
    .select("id,title,scheduled_at,duration_min,classroom_id,classrooms(name)")
    .is("deleted_at", null)
    .gte("scheduled_at", fromIso)
    .lt("scheduled_at", toIso)
    .order("scheduled_at", { ascending: true })
    .returns<StaffSessionRow[]>();
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
    if (!teacherByClassroom.has(row.classroom_id)) teacherByClassroom.set(row.classroom_id, row.profiles?.display_name ?? "");
  }

  return rows.map((row) => ({
    sessionId: row.id,
    classroomId: row.classroom_id,
    classroomName: row.classrooms?.name || "",
    lectureName: row.title,
    scheduledAt: row.scheduled_at,
    durationMin: row.duration_min ?? 0,
    teacherName: teacherByClassroom.get(row.classroom_id) ?? "",
    studentName: "",
  }));
}

// ---------------------------------------------------------------------------
// 点名（P4B-5 §5.5）：花名册逐人四态 upsert；有账号且该 session 有其 user
// 事件的默认预填 present，其余默认 absent，抽屉里都可手动改。
// ---------------------------------------------------------------------------

export interface AttendanceDrawerRow {
  studentId: string;
  studentName: string;
  status: AttendanceStatus;
  note: string;
}

export async function getAttendanceDrawerData(sessionId: string): Promise<AttendanceDrawerRow[]> {
  const { supabase } = await authorizedClient("attendance.mark");

  const { data: session, error: sessionError } = await supabase
    .from("class_sessions")
    .select("classroom_id")
    .eq("id", sessionId)
    .maybeSingle<{ classroom_id: string }>();
  if (sessionError) throw new Error(sessionError.message);
  if (!session) throw new Error("NOT_FOUND");

  const [{ data: rosterRows, error: rosterError }, { data: existingRows, error: existingError }, { data: eventRows, error: eventError }] =
    await Promise.all([
      supabase
        .from("enrollments")
        .select("student_id,students(name,user_id)")
        .eq("classroom_id", session.classroom_id)
        .eq("status", "active")
        .returns<Array<{ student_id: string; students: { name: string; user_id: string | null } | null }>>(),
      supabase
        .from("session_attendance")
        .select("student_id,status,note")
        .eq("session_id", sessionId)
        .returns<Array<{ student_id: string; status: AttendanceStatus; note: string }>>(),
      supabase
        .from("session_events")
        .select("user_id")
        .eq("session_id", sessionId)
        .returns<Array<{ user_id: string }>>(),
    ]);
  if (rosterError) throw new Error(rosterError.message);
  if (existingError) throw new Error(existingError.message);
  if (eventError) throw new Error(eventError.message);

  const existingByStudent = new Map((existingRows ?? []).map((row) => [row.student_id, row]));
  const participatedUserIds = new Set((eventRows ?? []).map((row) => row.user_id));

  return (rosterRows ?? []).map((row) => {
    const existing = existingByStudent.get(row.student_id);
    const userId = row.students?.user_id ?? null;
    const defaultStatus: AttendanceStatus = userId && participatedUserIds.has(userId) ? "present" : "absent";
    return {
      studentId: row.student_id,
      studentName: row.students?.name ?? "-",
      status: existing?.status ?? defaultStatus,
      note: existing?.note ?? "",
    };
  });
}

export async function saveAttendanceAction(
  sessionId: string,
  records: Array<{ studentId: string; status: AttendanceStatus; note: string }>,
): Promise<void> {
  const { supabase } = await authorizedClient("attendance.mark");
  if (records.length === 0) return;
  const { error } = await supabase.from("session_attendance").upsert(
    records.map((record) => ({
      session_id: sessionId,
      student_id: record.studentId,
      status: record.status,
      note: record.note.slice(0, 500),
    })),
    { onConflict: "session_id,student_id" },
  );
  if (error) throw new Error(error.message);
}

export interface SessionChangeOptions {
  students: Array<{ id: string; name: string }>;
  targets: Array<{ id: string; title: string; scheduledAt: string; classroomName: string }>;
}

export async function getSessionChangeOptionsAction(sessionId: string): Promise<SessionChangeOptions> {
  const { supabase } = await authorizedClient("attendance.mark");
  const { data, error } = await supabase.rpc("get_session_change_options", { p_session_id: sessionId });
  if (error) throw new Error(error.message);
  const value = data as Partial<SessionChangeOptions> | null;
  return { students: value?.students ?? [], targets: value?.targets ?? [] };
}

export async function recordSessionChangeAction(input: { sessionId: string; studentId: string; kind: "leave" | "makeup"; targetSessionId: string | null; reason: string }): Promise<void> {
  const { supabase } = await authorizedClient("attendance.mark");
  const { error } = await supabase.rpc("record_session_change", {
    p_session_id: input.sessionId,
    p_student_id: input.studentId,
    p_kind: input.kind,
    p_to_session: input.targetSessionId,
    p_reason: input.reason.trim().slice(0, 1000),
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 财务（P4B-6 §5.6）：下单/收款/退费走 security definer RPC，金额一律服务端算，
// 这里只透传 + 权限双闸第二道；表本身不给 insert/update，第三道 RLS 兜底只读。
// ---------------------------------------------------------------------------

export interface OrderItemInput {
  name: string;
  category: "course" | "material" | "other";
  unitPrice: number;
  qty: number;
  refundable: boolean;
}

/** 任一财务功能键即放行（与 authorizedClient 的单键模式不同，财务多个 tab 各管各的键）。 */
async function financeClient(keys: PermissionKey[]) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const perms = await getMyPerms(user.id);
  if (!keys.some((key) => perms.has(key))) throw new Error("FORBIDDEN");
  return { supabase, user };
}

export async function placeOrderAction(input: {
  studentId: string;
  classroomId: string | null;
  items: OrderItemInput[];
  kind: "enroll" | "makeup" | "deposit";
  couponGrantId: string | null;
  remark: string;
}): Promise<string> {
  const { supabase } = await authorizedClient("finance.order.create");
  const { data, error } = await supabase.rpc("place_order", {
    p_student_id: input.studentId,
    p_classroom_id: input.classroomId,
    p_items: input.items.map((item) => ({
      name: item.name.trim().slice(0, 100),
      category: item.category,
      unit_price: item.unitPrice,
      qty: item.qty,
      refundable: item.refundable,
    })),
    p_kind: input.kind,
    p_coupon_grant_id: input.couponGrantId,
    p_remark: input.remark.slice(0, 500),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function recordPaymentAction(orderId: string, amount: number, method: PaymentMethod, remark: string): Promise<void> {
  const { supabase } = await authorizedClient("finance.payment.record");
  const { error } = await supabase.rpc("record_payment", {
    p_order_id: orderId,
    p_amount: amount,
    p_method: method,
    p_remark: remark.slice(0, 500),
  });
  if (error) throw new Error(error.message);
}

export async function requestRefundAction(orderId: string, amount: number, reason: string): Promise<void> {
  const { supabase } = await authorizedClient("finance.refund.request");
  const { error } = await supabase.rpc("request_refund", {
    p_order_id: orderId,
    p_amount: amount,
    p_reason: reason.slice(0, 500),
  });
  if (error) throw new Error(error.message);
}

export async function approveRefundAction(refundId: string, ok: boolean): Promise<void> {
  const { supabase } = await authorizedClient("finance.refund.approve");
  const { error } = await supabase.rpc("approve_refund", { p_refund_id: refundId, p_ok: ok });
  if (error) throw new Error(error.message);
}

export async function createCouponAction(input: {
  code: string;
  name: string;
  kind: CouponKind;
  value: number;
  validFrom: string | null;
  validTo: string | null;
}): Promise<string> {
  const { supabase } = await authorizedClient("finance.coupon.manage");
  const { data, error } = await supabase.rpc("create_coupon", {
    p_code: input.code.trim().slice(0, 40),
    p_name: input.name.trim().slice(0, 100),
    p_kind: input.kind,
    p_value: input.value,
    p_scope: {},
    p_valid_from: input.validFrom,
    p_valid_to: input.validTo,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function setCouponStatusAction(couponId: string, status: "enabled" | "disabled"): Promise<void> {
  const { supabase } = await authorizedClient("finance.coupon.manage");
  const { error } = await supabase.rpc("set_coupon_status", { p_coupon_id: couponId, p_status: status });
  if (error) throw new Error(error.message);
}

export async function grantCouponAction(couponId: string, studentId: string): Promise<void> {
  const { supabase } = await authorizedClient("finance.coupon.manage");
  const { error } = await supabase.rpc("grant_coupon", { p_coupon_id: couponId, p_student_id: studentId });
  if (error) throw new Error(error.message);
}

export async function revokeCouponAction(grantId: string): Promise<void> {
  const { supabase } = await authorizedClient("finance.coupon.manage");
  const { error } = await supabase.rpc("revoke_coupon", { p_grant_id: grantId });
  if (error) throw new Error(error.message);
}

export async function grantScholarshipAction(studentId: string, amount: number, kind: ScholarshipKind, reason: string, orderId: string | null): Promise<void> {
  const { supabase } = await authorizedClient("finance.scholarship.grant");
  const { error } = await supabase.rpc("grant_scholarship", {
    p_student_id: studentId,
    p_amount: amount,
    p_kind: kind,
    p_reason: reason.slice(0, 500),
    p_order_id: orderId,
  });
  if (error) throw new Error(error.message);
}

export async function adjustAccountAction(studentId: string, delta: number, reason: string): Promise<void> {
  const { supabase } = await authorizedClient("finance.account.adjust");
  const { error } = await supabase.rpc("adjust_account", { p_student_id: studentId, p_delta: delta, p_reason: reason.slice(0, 500) });
  if (error) throw new Error(error.message);
}

export async function getOrderClassroomOptions(): Promise<Array<{ id: string; name: string; courseTitle: string | null }>> {
  const { supabase } = await financeClient(["finance.order.create"]);
  const { data, error } = await supabase.rpc("get_order_classroom_options");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; name: string; course_title: string | null }>).map((row) => ({
    id: row.id,
    name: row.name || "-",
    courseTitle: row.course_title,
  }));
}

export async function getStudentAccountAction(studentId: string): Promise<StudentAccount> {
  await financeClient(["finance.order.view", "finance.account.adjust", "finance.scholarship.grant", "finance.coupon.manage"]);
  return getStudentAccount(studentId);
}

export async function listAvailableCouponGrantsAction(studentId: string): Promise<CouponGrantOption[]> {
  await authorizedClient("finance.order.create");
  return listAvailableCouponGrants(studentId);
}

// ---------------------------------------------------------------------------
// 跟进时间线（P4B-2 §8：教师与学辅的日常写入口）。RLS 第三道兜底：
// followups_insert_staff_scope 只放行我作用域内学生；students 冗余字段由触发器更新。
// ---------------------------------------------------------------------------

const FOLLOW_UP_KINDS = ["note", "call", "class", "visit"] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

export async function addStudentFollowUp(
  studentId: string,
  input: { content: string; kind: FollowUpKind; nextFollowUpAt: string | null; statusAfter: string | null },
): Promise<void> {
  const content = input.content.trim().slice(0, 2000);
  if (!content) throw new Error("EMPTY_CONTENT");
  if (!FOLLOW_UP_KINDS.includes(input.kind)) throw new Error("INVALID_KIND");
  const statusAfter = input.statusAfter && (FOLLOW_UP_STATUSES as readonly string[]).includes(input.statusAfter) ? input.statusAfter : null;
  const nextFollowUpAt = input.nextFollowUpAt && !Number.isNaN(Date.parse(input.nextFollowUpAt)) ? new Date(input.nextFollowUpAt).toISOString() : null;
  const { supabase, user } = await authorizedClient("followup.write");
  const { error } = await supabase.from("student_follow_ups").insert({
    student_id: studentId,
    author_id: user.id,
    content,
    kind: input.kind,
    next_follow_up_at: nextFollowUpAt,
    status_after: statusAfter,
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 新建学生 / 改学生状态（P4C-6 §6：跟进工作台的两个快捷写入口）。
// create_student RPC 只收姓名/年级/电话；来源与备注是 students 直列，创建后补写。
// ---------------------------------------------------------------------------

export interface CreateStudentInput {
  name: string;
  grade: number | null;
  phone: string;
  region?: string;
  source: string;
  parentName?: string;
  parentPhone?: string;
  remark: string;
}

export async function createStudentAction(input: CreateStudentInput): Promise<string> {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new Error("EMPTY_NAME");
  const grade =
    typeof input.grade === "number" && Number.isInteger(input.grade) && input.grade >= 1 && input.grade <= 12
      ? input.grade
      : null;
  const { supabase } = await authorizedClient("student.create");
  const { data, error } = await supabase.rpc("create_student", {
    p_name: name,
    p_grade: grade,
    p_phone: input.phone.trim().slice(0, 40),
    p_region: input.region?.trim().slice(0, 100) ?? "",
    p_source: input.source.trim().slice(0, 100),
    p_parent_name: input.parentName?.trim().slice(0, 100) ?? "",
    p_parent_phone: input.parentPhone?.trim().slice(0, 40) ?? "",
    p_remark: input.remark.trim().slice(0, 2000),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface UpdateStudentInput {
  name: string;
  gender: string;
  birthday: string | null;
  phone: string;
  wechat: string;
  school: string;
  grade: number | null;
  region: string;
  source: string;
  parentName: string;
  parentRelation: string;
  parentPhone: string;
  remark: string;
}

export async function updateStudentAction(studentId: string, input: UpdateStudentInput): Promise<void> {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new Error("EMPTY_NAME");
  const grade = input.grade === null
    ? null
    : Number.isInteger(input.grade) && input.grade >= 1 && input.grade <= 12
      ? input.grade
      : null;
  const birthday = input.birthday && /^\d{4}-\d{2}-\d{2}$/.test(input.birthday) ? input.birthday : null;
  const { supabase } = await authorizedClient("student.edit");
  const { data, error } = await supabase
    .from("students")
    .update({
      name,
      gender: input.gender.trim().slice(0, 30),
      birthday,
      phone: input.phone.trim().slice(0, 40),
      wechat: input.wechat.trim().slice(0, 80),
      school: input.school.trim().slice(0, 100),
      grade,
      region: input.region.trim().slice(0, 100),
      source: input.source.trim().slice(0, 100),
      parent_name: input.parentName.trim().slice(0, 100),
      parent_relation: input.parentRelation.trim().slice(0, 40),
      parent_phone: input.parentPhone.trim().slice(0, 40),
      remark: input.remark.trim().slice(0, 2000),
    })
    .eq("id", studentId)
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("NOT_FOUND");
}

export async function assignStudentAction(studentId: string, staffUserId: string): Promise<void> {
  const { supabase } = await authorizedClient("student.assign");
  const { error } = await supabase.rpc("assign_student", {
    p_student_id: studentId,
    p_staff_user_id: staffUserId,
  });
  if (error) throw new Error(error.message);
}

export interface ImportStudentRow {
  name: string;
  phone: string;
  grade: number | string | null;
  region: string;
  source: string;
  remark: string;
}

export interface ImportStudentsResult {
  inserted: number;
  dup: number;
  errors: Array<{ row: number; reason: string }>;
}

export async function importStudentsAction(rows: ImportStudentRow[]): Promise<ImportStudentsResult> {
  if (rows.length > 500) throw new Error("TOO_MANY_ROWS");
  const { supabase } = await authorizedClient("student.import");
  const { data, error } = await supabase.rpc("import_students", { p_rows: rows });
  if (error) throw new Error(error.message);
  const result = data as Partial<ImportStudentsResult> | null;
  return {
    inserted: Number(result?.inserted) || 0,
    dup: Number(result?.dup) || 0,
    errors: Array.isArray(result?.errors) ? result.errors : [],
  };
}

export async function softDeleteStudentAction(studentId: string): Promise<{ ok: true } | { ok: false; code: "ACTIVE_ENROLLMENT" | "FAILED" }> {
  const { supabase } = await authorizedClient("student.delete");
  const { error } = await supabase.rpc("soft_delete_student", { p_student_id: studentId });
  if (!error) return { ok: true };
  return { ok: false, code: error.message.includes("ACTIVE_ENROLLMENT") ? "ACTIVE_ENROLLMENT" : "FAILED" };
}

export async function restoreStudentAction(studentId: string): Promise<boolean> {
  const { supabase } = await authorizedClient("student.delete");
  const { error } = await supabase.rpc("restore_student", { p_student_id: studentId });
  return !error;
}
export async function recoverLostStudentAction(studentId:string):Promise<void>{const{supabase}=await authorizedClient("student.edit");const{error}=await supabase.rpc("recover_lost_student",{p_student_id:studentId});if(error)throw new Error(error.message)}

export async function changeStudentStatusAction(studentId: string, status: StudentStatus): Promise<void> {
  if (!(STUDENT_STATUSES as readonly string[]).includes(status)) throw new Error("INVALID_STATUS");
  const { supabase } = await authorizedClient("student.edit");
  const { error } = await supabase.rpc("change_student_status", { p_student_id: studentId, p_status: status });
  if (error) throw new Error(error.message);
}

export async function searchStudentsForFinance(query: string): Promise<StudentSearchResult[]> {
  const { supabase } = await financeClient([
    "finance.order.view",
    "finance.order.create",
    "finance.payment.record",
    "finance.refund.request",
    "finance.refund.approve",
    "finance.coupon.manage",
    "finance.scholarship.grant",
    "finance.account.adjust",
  ]);
  const trimmed = query.trim().slice(0, 80);
  if (!trimmed) return [];
  const escaped = trimmed.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const { data, error } = await supabase
    .from("students")
    .select("id,name,grade,status")
    .is("deleted_at", null)
    .ilike("name", `%${escaped}%`)
    .limit(10)
    .returns<StudentSearchResult[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// P4D-1 课程 / 讲次 / 班级基础 CRUD。
// ---------------------------------------------------------------------------

export interface CourseWriteInput {
  title: string;
  productCode: string;
  grade: number;
  term: number;
  classType: string;
  status: "enabled" | "disabled";
}

function cleanCourseInput(input: CourseWriteInput) {
  const title = input.title.trim().slice(0, 100);
  if (!title) throw new Error("EMPTY_TITLE");
  if (!Number.isInteger(input.grade) || input.grade < 1 || input.grade > 9) throw new Error("INVALID_GRADE");
  if (!Number.isInteger(input.term) || input.term < 1 || input.term > 4) throw new Error("INVALID_TERM");
  return {
    title,
    product_code: input.productCode.trim().slice(0, 40) || null,
    grade: input.grade,
    term: input.term,
    class_type: input.classType.trim().slice(0, 20),
    status: input.status,
  };
}

export async function createCourseAction(input: CourseWriteInput): Promise<string> {
  const { supabase, user } = await authorizedClient("course.manage");
  const { data, error } = await supabase.from("courses").insert({ ...cleanCourseInput(input), created_by: user.id }).select("id").single<{ id: string }>();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function updateCourseAction(courseId: string, input: CourseWriteInput): Promise<void> {
  const { supabase } = await authorizedClient("course.manage");
  const { data, error } = await supabase.from("courses").update(cleanCourseInput(input)).eq("id", courseId).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("NOT_FOUND");
}

export async function createLectureAction(courseId: string, name: string, objectives: string): Promise<void> {
  const { supabase } = await authorizedClient("course.manage");
  const { error } = await supabase.rpc("create_course_lecture", { p_course_id: courseId, p_name: name, p_objectives: objectives });
  if (error) throw new Error(error.message);
}

export async function updateLectureAction(lectureId: string, name: string, objectives: string): Promise<void> {
  const cleanName = name.trim().slice(0, 100);
  if (!cleanName) throw new Error("EMPTY_NAME");
  const { supabase } = await authorizedClient("course.manage");
  const { data, error } = await supabase.from("course_lectures").update({ name: cleanName, objectives: objectives.trim().slice(0, 2000) }).eq("id", lectureId).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("NOT_FOUND");
}

export async function deleteLectureAction(lectureId: string): Promise<"ok" | "in_use" | "failed"> {
  const { supabase } = await authorizedClient("course.manage");
  const { error } = await supabase.rpc("delete_course_lecture", { p_lecture_id: lectureId });
  if (!error) return "ok";
  return error.message.includes("LECTURE_IN_USE") ? "in_use" : "failed";
}

export async function reorderLecturesAction(courseId: string, lectureIds: string[]): Promise<void> {
  const { supabase } = await authorizedClient("course.manage");
  const { error } = await supabase.rpc("reorder_course_lectures", { p_course_id: courseId, p_lecture_ids: lectureIds });
  if (error) throw new Error(error.message);
}

export async function updateClassroomAction(classroomId: string, input: { name: string; capacity: number | null; room: string; grade: number | null }): Promise<void> {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new Error("EMPTY_NAME");
  const capacity = input.capacity === null ? null : Number.isInteger(input.capacity) && input.capacity > 0 ? input.capacity : null;
  const grade = input.grade === null ? null : Number.isInteger(input.grade) && input.grade >= 1 && input.grade <= 12 ? input.grade : null;
  const { supabase } = await authorizedClient("class.manage");
  const { data, error } = await supabase.from("classrooms").update({ name, capacity, room: input.room.trim().slice(0, 100), grade }).eq("id", classroomId).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("FORBIDDEN_SCOPE");
}

// ---------------------------------------------------------------------------
// 员工与岗位权限（P4C-3 §8）
// ---------------------------------------------------------------------------

/** 服务端错误码白名单：Server Action 抛错在生产会被脱敏，故用返回值把已知码带回 UI 翻译成 toast。 */
const STAFF_ERROR_CODES = new Set([
  "FORBIDDEN",
  "CANNOT_GRANT_SELF",
  "CANNOT_REVOKE_SELF",
  "CANNOT_CHANGE_SELF",
  "TARGET_NOT_STAFF",
  "NOT_FOUND",
  "ROLE_NOT_FOUND",
  "INVALID_NAME",
  "SYSTEM_ROLE",
  "ROLE_HAS_MEMBERS",
  "INVALID_PERMISSION_KEYS",
  "INVALID_ROLE",
  "INVALID_REPLACEMENT",
]);

export type StaffActionResult = ActionResult;

function staffResult(error: { message: string } | null): StaffActionResult {
  if (!error) return { ok: true };
  return { ok: false, code: STAFF_ERROR_CODES.has(error.message) ? error.message : "UNKNOWN" };
}

export interface FoundProfile {
  userId: string;
  displayName: string;
  identity: "student" | "parent" | "staff" | "admin";
}

/** 按邮箱精确查找账号（添加员工入口）。邮箱只走 POST 体，不写日志、不进 URL。 */
export async function findProfileByEmailAction(email: string): Promise<FoundProfile | null> {
  const { supabase } = await authorizedClient("staff.manage");
  const trimmed = email.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase.rpc("find_profile_by_email", { p: trimmed });
  if (error) throw new Error("LOOKUP_FAILED");
  const row = ((data ?? []) as Array<{ user_id: string; display_name: string; identity: FoundProfile["identity"] }>)[0];
  return row ? { userId: row.user_id, displayName: row.display_name, identity: row.identity } : null;
}

export async function grantStaffRoleAction(target: string, roleId: string): Promise<StaffActionResult> {
  const { supabase } = await authorizedClient("staff.manage");
  const { error } = await supabase.rpc("grant_staff_role", { target, p_role_id: roleId });
  return staffResult(error);
}

export async function revokeStaffRoleAction(target: string, roleId: string): Promise<StaffActionResult> {
  const { supabase } = await authorizedClient("staff.manage");
  const { error } = await supabase.rpc("revoke_staff_role", { target, p_role_id: roleId });
  return staffResult(error);
}

/** 提升为员工身份：双闸——UI 仅 admin 可见，RPC 本身也仅 admin（docs/plan/11 §10 员工页层）。 */
export async function promoteToStaffAction(target: string): Promise<StaffActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const profile = await getProfile(user.id);
  if (profile?.role !== "admin") return { ok: false, code: "FORBIDDEN" };
  const { error } = await supabase.rpc("admin_set_identity", { target, new_role: "staff" });
  return staffResult(error);
}

export async function createStaffRoleAction(name: string): Promise<StaffActionResult & { roleId?: string }> {
  const { supabase } = await authorizedClient("permission.configure");
  const { data, error } = await supabase.rpc("create_staff_role", { p_name: name });
  const result = staffResult(error);
  return result.ok ? { ok: true, roleId: (data as string | null) ?? undefined } : result;
}

export async function renameStaffRoleAction(roleId: string, name: string): Promise<StaffActionResult> {
  const { supabase } = await authorizedClient("permission.configure");
  const { error } = await supabase.rpc("rename_staff_role", { role_id: roleId, p_name: name });
  return staffResult(error);
}

export async function deleteStaffRoleAction(roleId: string): Promise<StaffActionResult> {
  const { supabase } = await authorizedClient("permission.configure");
  const { error } = await supabase.rpc("delete_staff_role", { role_id: roleId });
  return staffResult(error);
}

export async function setRolePermissionsAction(roleId: string, keys: string[]): Promise<StaffActionResult> {
  const { supabase } = await authorizedClient("permission.configure");
  const cleanKeys = keys.filter(isPermissionKey);
  if (cleanKeys.length !== keys.length) return { ok: false, code: "INVALID_PERMISSION_KEYS" };
  const { error } = await supabase.rpc("set_role_permissions", { p_role_id: roleId, perm_keys: cleanKeys });
  return staffResult(error);
}

export async function deactivateStaffAction(target: string, reassignTo: string | null): Promise<StaffActionResult> {
  try {
    const { supabase } = await authorizedClient("staff.manage");
    const { error } = await supabase.rpc("deactivate_staff", { p_target: target, p_reassign_to: reassignTo });
    return staffResult(error);
  } catch (error) {
    return { ok: false, code: error instanceof Error && STAFF_ERROR_CODES.has(error.message) ? error.message : "UNKNOWN" };
  }
}
