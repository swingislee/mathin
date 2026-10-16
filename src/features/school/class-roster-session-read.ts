import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser, getMyPerms } from "@/lib/auth";
import { resolveSessionCapabilities } from "./teaching-operations/capabilities";
import { deriveSessionState, resolveSessionCapabilityContext } from "./teaching-operations/scopes";
import type { StaffResponsibility } from "./teaching-operations/types";
import { getClassroomWorkSessions } from "./classroom-workbench-read";
import { readSchoolQueryBatches } from "./school-query-pages";
import { getTeachingRecords, getTeachingSessionRecords } from "./teaching-workbench/teaching-records-read";
import { classSessionDetailSchema, type ClassRosterSession } from "./class-roster-session-contract";
import { getSessionQuickRow } from "./classes";
import { summarizeTeachingObservations, type TeachingObservations } from "./teaching-workbench/teaching-learning-summary";

/** 只读取展开班级的课次，限制并发；失败保留为未知，避免将未读到的数据显示成零。 */
export async function getClassSessionObservations(classroomId: string, sessionIds: string[]) {
  const summaries: Array<{ sessionId: string; observations: TeachingObservations | null }> = [];
  const ids = [...new Set(sessionIds)];
  for (let offset = 0; offset < ids.length; offset += 4) {
    summaries.push(...await Promise.all(ids.slice(offset, offset + 4).map(async sessionId => {
      try {
        const records = await getTeachingSessionRecords(sessionId);
        if (records.session.classroomId !== classroomId) return { sessionId, observations: null };
        return { sessionId, observations: summarizeTeachingObservations(records) };
      } catch {
        return { sessionId, observations: null };
      }
    })));
  }
  return summaries;
}

export async function getClassRosterSessions(classroomIds: string[]): Promise<ClassRosterSession[]> {
  const [sessions, user] = await Promise.all([getClassroomWorkSessions(classroomIds), getAuthUser()]);
  if (!user || !sessions.length) return [];
  const ids = sessions.map(session => session.id);
  const visibleClassroomIds = [...new Set(sessions.map(session => session.classroomId))];
  const supabase = await createClient();
  const [attendance, reviews, assignments, lifecycle, permissions] = await Promise.all([
    readSchoolQueryBatches(ids, (batch, start, end) => supabase.from("session_attendance").select("session_id")
      .in("session_id", batch).order("session_id").order("student_id").range(start, end)),
    readSchoolQueryBatches(ids, (batch, start, end) => supabase.from("session_reviews").select("session_id")
      .in("session_id", batch).order("session_id").order("student_id").range(start, end)),
    // 与课次详情复用同一能力公式；批量读取责任关系和代课人，不为每一课请求完整详情。
    readSchoolQueryBatches(visibleClassroomIds, (batch, start, end) => supabase.from("classroom_staff_assignments")
      .select("classroom_id,responsibility").in("classroom_id", batch).eq("user_id", user.id)
      .order("classroom_id").order("responsibility").range(start, end)
      .returns<Array<{ classroom_id: string; responsibility: StaffResponsibility }>>()),
    readSchoolQueryBatches(ids, (batch, start, end) => supabase.from("class_sessions")
      .select("id,classroom_id,teacher_override,scheduled_at,duration_min,started_at,ended_at,deleted_at,cancelled_by,voided_at")
      .in("id", batch).order("id").range(start, end)),
    getMyPerms(user.id),
  ]);
  if (attendance.error || reviews.error || assignments.error || lifecycle.error) throw new Error("CLASS_SESSION_SUMMARY_UNAVAILABLE");
  const counts = (rows: { session_id: string }[]) => {
    const values = new Map<string, number>();
    for (const row of rows) values.set(row.session_id, (values.get(row.session_id) ?? 0) + 1);
    return values;
  };
  const marked = counts(attendance.data ?? []), reviewed = counts(reviews.data ?? []);
  const responsibilities = new Map<string, StaffResponsibility[]>();
  for (const row of assignments.data ?? []) {
    const values = responsibilities.get(row.classroom_id) ?? [];
    values.push(row.responsibility);
    responsibilities.set(row.classroom_id, values);
  }
  const currentSessions = new Map((lifecycle.data ?? []).map(row => [row.id, row]));
  const hasClassViewAll = permissions.has("class.view.all");
  return sessions.map(session => {
    const current = currentSessions.get(session.id);
    const roles = responsibilities.get(session.classroomId) ?? [];
    const isTeaching = roles.includes("primary_teacher") || roles.includes("assistant_teacher");
    const capabilities = current && current.classroom_id === session.classroomId && !current.deleted_at && !current.cancelled_by && !current.voided_at
      ? resolveSessionCapabilities(resolveSessionCapabilityContext({
        responsibilities: roles,
        isTeacherOverride: current.teacher_override === user.id,
        hasClassManageScope: permissions.has("class.manage") && (hasClassViewAll || isTeaching),
        hasClassViewAll,
        hasCourseManage: permissions.has("course.manage"),
        hasSessionVoid: permissions.has("session.void"),
        hasAttendanceMark: permissions.has("attendance.mark"),
        hasReviewWrite: permissions.has("review.write"),
        hasReviewVideo: permissions.has("video.review"),
        hasPostworkManage: permissions.has("session.postwork.manage"),
        state: deriveSessionState({ startedAt: current.started_at, endedAt: current.ended_at,
          deletedAt: current.deleted_at, cancelledBy: current.cancelled_by, voidedAt: current.voided_at }),
      })) : undefined;
    return { ...session, scheduledAt: current?.scheduled_at ?? session.scheduledAt, durationMin: current?.duration_min ?? null,
      startedAt: current?.started_at ?? session.startedAt, endedAt: current?.ended_at ?? session.endedAt,
      attendanceCount: marked.get(session.id) ?? 0, reviewCount: reviewed.get(session.id) ?? 0,
      capabilities: capabilities ? { canOpenManagement: capabilities.canOpenManagement, canPrepare: capabilities.canPrepare,
        canEnterLive: capabilities.canEnterLive, canRehearse: capabilities.canEditPreparationArchive } : undefined };
  });
}

export async function getClassSessionDetail(sessionId: string, classroomId: string, userId: string, canReview: boolean) {
  const quick = await getSessionQuickRow(sessionId);
  if (!quick || quick.classroomId !== classroomId || quick.deletedAt || !quick.capabilities.canOpenManagement || ["cancelled", "voided"].includes(quick.state)) throw new Error("SESSION_NOT_FOUND");
  if (quick.state === "scheduled") return classSessionDetailSchema.parse({ stage: "pre",
    scheduledAt: quick.scheduledAt, durationMin: quick.durationMin,
    canPrepare: quick.capabilities.canPrepare, canEnterLive: quick.capabilities.canEnterLive, canMarkAttendance: quick.capabilities.canMarkAttendance });
  // 先由现有 RPC 核对课次可见范围，再读取编辑能力；客户端传入的班级不能改变授权范围。
  const records = await getTeachingRecords(sessionId, 1);
  if (records.session.classroomId !== classroomId) throw new Error("SESSION_NOT_FOUND");
  const supabase = await createClient();
  const [permission, heads, session] = await Promise.all([
    canReview ? supabase.rpc("can_review_session", { cid: classroomId, uid: userId }) : Promise.resolve({ data: false, error: null }),
    supabase.from("learning_result_heads").select("status").eq("session_id", sessionId).eq("kind", "session_review"),
    supabase.from("class_sessions").select("cancelled_by").eq("id", sessionId).maybeSingle(),
  ]);
  if (permission.error || heads.error || session.error || !session.data) throw new Error("CLASS_SESSION_DETAIL_UNAVAILABLE");
  const statuses = new Set((heads.data ?? []).map(row => row.status));
  const resultStatus = ["revised", "withdrawn", "published", "review"].find(status => statuses.has(status)) ?? "draft";
  return classSessionDetailSchema.parse({ records, canEnterLive: quick.capabilities.canEnterLive,
    canWriteReview: permission.data === true && !session.data.cancelled_by, resultStatus });
}
