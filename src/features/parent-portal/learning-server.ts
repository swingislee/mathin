import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  LearningAttendance, LearningLeaveRequest, LearningNotification, LearningSession, ParentLearning,
} from "../../../contracts/parent-api/portal";
import { authorize, PortalError, readJson, readReports, requireResult, response } from "./server";
import { learningCommandSchema, learningCourses, learningNotificationLink, learningQuerySchema, learningRange } from "./learning-contract";

type ParticipantRow = { id: string; name: string };
type ScheduleRow = {
  session_id: string; student_id: string; classroom_id: string; classroom_name: string; lecture_name: string;
  scheduled_at: string; duration_min: number | null; teacher_name: string | null;
};
type AttendanceRow = {
  session_id: string; student_id: string; classroom_name: string; lecture_name: string; scheduled_at: string;
  status: LearningAttendance["status"]; note: string | null;
};
type SummaryRow = { student_id: string; grade: number | null; next_session_at: string | null; week_session_count: number; star_total: number };
type NotificationRow = {
  id: string; notification_key: string; occurred_at: string; read_at: string | null; deep_link: string | null; payload: unknown;
};
type LeaveRow = {
  id: string; session_id: string; student_id: string; session_title: string; reason: string;
  status: LearningLeaveRequest["status"]; created_at: string; decided_at: string | null;
  makeup_session_id: string | null; makeup_session_title: string | null; makeup_classroom_name: string | null;
  makeup_scheduled_at: string | null; makeup_status: LearningLeaveRequest["makeupStatus"];
};

async function requireParticipant(db: SupabaseClient, id: string) {
  const students: ParticipantRow[] = requireResult(await db.rpc("get_my_students")) ?? [];
  if (!students.some((student) => student.id === id)) throw new PortalError("FORBIDDEN");
}

function notification(row: NotificationRow): LearningNotification {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown> : {};
  const text = (key: string) => typeof payload[key] === "string" ? payload[key] as string : null;
  const participant = z.string().uuid().safeParse(payload.studentId);
  return {
    id: row.id, type: row.notification_key, occurredAt: row.occurred_at, readAt: row.read_at,
    link: learningNotificationLink(row.deep_link), participantId: participant.success ? participant.data : null,
    studentName: text("studentName"), classroomName: text("classroomName"), sessionTitle: text("sessionTitle"),
  };
}

export async function learningGet(request: Request) {
  const input = learningQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const now = Date.now();
  const range = learningRange(input, now);
  const { db, user } = await authorize(request);
  await requireParticipant(db, input.participant);
  const rpcRange = { p_from: range.from, p_to: range.to };
  const [scheduleResult, attendanceResult, summaryResult, notificationsResult, leaveResult, reports] = await Promise.all([
    db.rpc("get_my_schedule", rpcRange),
    db.rpc("get_my_attendance", rpcRange),
    db.rpc("get_my_learning_summary"),
    db.from("notifications").select("id,notification_key,occurred_at,deep_link,payload,read_at")
      .eq("recipient_id", user.id).is("archived_at", null).order("occurred_at", { ascending: false }).limit(100),
    db.rpc("list_my_session_leave_requests"),
    readReports(db, now),
  ]);
  // RPC 已按亲子关系授权；再次按稳定学生 ID 切片以保持多孩子独立视图。
  const schedule: LearningSession[] = ((requireResult(scheduleResult) ?? []) as ScheduleRow[])
    .filter((row) => row.student_id === input.participant)
    .map((row) => ({
      id: row.session_id, participantId: row.student_id, classroomId: row.classroom_id, classroomName: row.classroom_name,
      title: row.lecture_name, startsAt: row.scheduled_at, durationMinutes: row.duration_min, teacherName: row.teacher_name || null,
    }))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const attendance: LearningAttendance[] = ((requireResult(attendanceResult) ?? []) as AttendanceRow[])
    .filter((row) => row.student_id === input.participant)
    .map((row) => ({
      sessionId: row.session_id, participantId: row.student_id, classroomName: row.classroom_name, title: row.lecture_name,
      startsAt: row.scheduled_at, status: row.status, note: row.note ?? "",
    }));
  const summary = ((requireResult(summaryResult) ?? []) as SummaryRow[]).find((row) => row.student_id === input.participant);
  const leaveRequests: LearningLeaveRequest[] = ((requireResult(leaveResult) ?? []) as LeaveRow[])
    .filter((row) => row.student_id === input.participant)
    .map((row) => ({
      id: row.id, sessionId: row.session_id, participantId: row.student_id, sessionTitle: row.session_title,
      reason: row.reason, status: row.status, createdAt: row.created_at, decidedAt: row.decided_at,
      makeupSessionId: row.makeup_session_id, makeupSessionTitle: row.makeup_session_title,
      makeupClassroomName: row.makeup_classroom_name, makeupStartsAt: row.makeup_scheduled_at, makeupStatus: row.makeup_status,
    }));
  const result: ParentLearning = {
    participantId: input.participant, generatedAt: new Date(now).toISOString(), range,
    summary: summary ? { grade: summary.grade, nextSessionAt: summary.next_session_at, weekSessionCount: summary.week_session_count, starTotal: summary.star_total } : null,
    courses: learningCourses(schedule, now), schedule, attendance,
    notifications: ((requireResult(notificationsResult) ?? []) as NotificationRow[]).map(notification), leaveRequests,
    reports: reports.filter((report) => report.participantId === input.participant),
    unassignedReportCount: reports.filter((report) => report.participantId === null).length,
    capabilities: { leaveRequests: true, notificationRead: true, chat: false, rescheduling: false, wrongAnswers: false, profileEditing: false, payments: false },
  };
  return response(result);
}

export async function learningPost(request: Request) {
  const input = learningCommandSchema.parse(await readJson(request));
  const { db } = await authorize(request);
  if (input.action === "readNotification") {
    const marked = requireResult(await db.rpc("mark_notification_read", { p_notification_id: input.id }));
    if (marked !== true) throw new PortalError("NOT_FOUND");
    return response({ ok: true });
  }
  await requireParticipant(db, input.participantId);
  const result = await db.rpc("submit_session_leave_request", {
    p_session_id: input.sessionId, p_student_id: input.participantId, p_reason: input.reason,
  });
  if (result.error) {
    if (result.error.message === "SESSION_NOT_FOUND") throw new PortalError("NOT_FOUND");
    if (result.error.message === "SESSION_NOT_LEAVABLE") throw new PortalError("CONFLICT");
    if (result.error.message === "STUDENT_NOT_ENROLLED") throw new PortalError("FORBIDDEN");
  }
  const id = requireResult(result);
  if (!z.string().uuid().safeParse(id).success) throw new PortalError("UNAVAILABLE");
  return response({ id }, 201);
}
