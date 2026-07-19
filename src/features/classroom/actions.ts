"use server";

import { z } from "zod";
import { materializeSessionResolved, type CoursewareTrack } from "@/features/courseware-studio/data";
import { resolveCourseware, type CoursewareTemplatePage, type OverlaySlot } from "@/features/school/courseware-overlay";
import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { buildSessionReport } from "./report";
import type {
  AssignmentContent,
  AssignmentMeta,
  AssignmentRecord,
  ClassroomMember,
  ClassroomMeta,
  ClassroomRecord,
  ClassroomRole,
  ClassSessionMeta,
  ClassSessionRecord,
  CoursewarePage,
  SessionEvent,
  SessionEventType,
  SessionReport,
  SubmissionRecord,
} from "./types";

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return { supabase, user };
}

export async function listMyClassrooms(): Promise<ClassroomMeta[]> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from("classroom_members")
    .select("role,classrooms(id,name,owner_id,created_at)")
    .eq("user_id", user.id)
    .returns<Array<{ role: ClassroomRole; classrooms: { id: string; name: string; owner_id: string; created_at: string } | null }>>();
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row) => row.classrooms)
    .map((row) => ({
      id: row.classrooms!.id,
      name: row.classrooms!.name,
      ownerId: row.classrooms!.owner_id,
      createdAt: row.classrooms!.created_at,
      myRole: row.role,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createClassroom(name: string): Promise<string> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase.rpc("create_classroom", { p_name: name.trim().slice(0, 100) });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function joinClassroom(code: string): Promise<string | null> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase.rpc("join_classroom", { p_code: code.trim().toLowerCase() });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export async function getClassroom(id: string): Promise<ClassroomRecord | null> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from("classrooms")
    .select("id,name,owner_id,created_at")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string; owner_id: string; created_at: string }>();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: memberRows, error: memberError } = await supabase
    .from("classroom_members")
    .select("user_id,role,created_at,profiles(display_name)")
    .eq("classroom_id", id)
    .order("created_at", { ascending: true })
    .returns<Array<{ user_id: string; role: ClassroomRole; created_at: string; profiles: { display_name: string } | null }>>();
  if (memberError) throw new Error(memberError.message);

  const members: ClassroomMember[] = (memberRows ?? []).map((row) => ({
    userId: row.user_id,
    displayName: row.profiles?.display_name || "",
    role: row.role,
  }));
  const myRole = members.find((member) => member.userId === user.id)?.role
    ?? (data.owner_id === user.id ? "teacher" : null);
  if (!myRole) return null;

  let inviteCode: string | null = null;
  if (myRole === "teacher") {
    const { data: code } = await supabase.rpc("get_classroom_invite", { cid: id });
    inviteCode = (code as string | null) ?? null;
  }

  return {
    id: data.id,
    name: data.name,
    ownerId: data.owner_id,
    createdAt: data.created_at,
    myRole,
    members,
    inviteCode,
  };
}

export async function removeClassroomMember(classroomId: string, userId: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase
    .from("classroom_members")
    .delete()
    .eq("classroom_id", classroomId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function leaveClassroom(classroomId: string): Promise<void> {
  const { supabase, user } = await authenticatedClient();
  const { error } = await supabase
    .from("classroom_members")
    .delete()
    .eq("classroom_id", classroomId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 课次与课件（P4-4）
// ---------------------------------------------------------------------------

const pageBase = { id: z.string().uuid(), title: z.string().max(100) };
const coursewareSchema = z
  .array(
    z.discriminatedUnion("type", [
      z.object({ ...pageBase, type: z.literal("image"), path: z.string().min(1).max(500) }),
      z.object({ ...pageBase, type: z.literal("video"), path: z.string().min(1).max(500) }),
      z.object({
        ...pageBase,
        type: z.literal("game"),
        gameId: z.string().min(1).max(50),
        difficulty: z.enum(["easy", "medium", "hard"]),
        seed: z.string().min(1).max(100),
      }),
      z.object({ ...pageBase, type: z.literal("board") }),
    ]),
  )
  .max(200);

interface SessionRow {
  id: string;
  classroom_id: string;
  title: string;
  courseware: CoursewarePage[];
  courseware_overlay: unknown[];
  current_page: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  lecture_id: string | null;
  lecture_no: number | null;
  scheduled_at: string | null;
  duration_min: number | null;
  courseware_frozen_at: string | null;
}

const SESSION_COLUMNS =
  "id,classroom_id,title,courseware,courseware_overlay,current_page,started_at,ended_at,created_at," +
  "lecture_id,lecture_no,scheduled_at,duration_min,courseware_frozen_at";

function toSessionMeta(row: SessionRow): ClassSessionMeta {
  return {
    id: row.id,
    classroomId: row.classroom_id,
    title: row.title,
    pageCount: Array.isArray(row.courseware) ? row.courseware.length : 0,
    currentPage: row.current_page,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    lectureId: row.lecture_id,
    lectureNo: row.lecture_no,
    scheduledAt: row.scheduled_at,
    durationMin: row.duration_min,
    coursewareFrozenAt: row.courseware_frozen_at,
  };
}

export async function listClassSessions(classroomId: string): Promise<ClassSessionMeta[]> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase
    .from("class_sessions")
    .select(SESSION_COLUMNS)
    .eq("classroom_id", classroomId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .returns<SessionRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map(toSessionMeta);
}

export async function createClassSession(classroomId: string, title: string): Promise<string> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase
    .from("class_sessions")
    .insert({ classroom_id: classroomId, title: title.trim().slice(0, 100) })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function getClassSession(sessionId: string): Promise<ClassSessionRecord | null> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase
    .from("class_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle<SessionRow>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    ...toSessionMeta(data),
    courseware: Array.isArray(data.courseware) ? data.courseware : [],
    coursewareOverlay: Array.isArray(data.courseware_overlay) ? data.courseware_overlay : [],
  };
}

export async function renameClassSession(sessionId: string, title: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({ title: title.trim().slice(0, 100) })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
}

export async function saveCourseware(sessionId: string, pages: CoursewarePage[]): Promise<void> {
  const parsed = coursewareSchema.safeParse(pages);
  if (!parsed.success) throw new Error("INVALID_COURSEWARE");
  const { supabase } = await authenticatedClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({ courseware: parsed.data })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
}

export async function deleteClassSession(sessionId: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.from("class_sessions").delete().eq("id", sessionId);
  if (error) throw new Error(error.message);
}

/**
 * 开课：mode=rehearsal 不调用本函数（LiveShell 的 prep phase 对试讲直接跳过）。
 * 若课次挂了讲次且未冻结，先服务端 resolve(模板+覆盖层) 落 courseware，
 * 与 started_at 一起原子写入（同一条 UPDATE ... WHERE started_at is null，
 * 天然充当行锁：并发开课只有一次真正生效，见 10-§5.4）。
 */
export async function startClassSession(sessionId: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { data: session, error: fetchError } = await supabase
    .from("class_sessions")
    .select("lecture_id,courseware_overlay,courseware_frozen_at,started_at")
    .eq("id", sessionId)
    .maybeSingle<{
      lecture_id: string | null;
      courseware_overlay: OverlaySlot[];
      courseware_frozen_at: string | null;
      started_at: string | null;
    }>();
  if (fetchError) throw new Error(fetchError.message);
  if (!session || session.started_at) return;

  if (session.lecture_id && !session.courseware_frozen_at) {
    const { data: lecture, error: lectureError } = await supabase
      .from("course_lectures")
      .select("courseware_template")
      .eq("id", session.lecture_id)
      .maybeSingle<{ courseware_template: CoursewareTemplatePage[] }>();
    if (lectureError) throw new Error(lectureError.message);
    const { data: resolvedRelease, error: resolvedReleaseError } = await supabase.rpc("resolve_session_courseware_release", {
      p_session_id: sessionId,
    });
    if (resolvedReleaseError) throw new Error(resolvedReleaseError.message);
    const selected = resolvedRelease?.[0] as { track: CoursewareTrack; release_id: string | null } | undefined;
    if (!selected) throw new Error("COURSEWARE_TRACK_NOT_RESOLVED");
    if (selected.track === "adapted-4x3" && !selected.release_id) throw new Error("COURSEWARE_TRACK_UNPUBLISHED");
    const resolved = resolveCourseware(lecture?.courseware_template ?? [], session.courseware_overlay ?? []);
    // P6-2：同一 DB 事务同时冻结页数组、解析对象 pin 与开课时间。
    // 讲次已发布 release 时必须物化 releaseId + objectHash 清单——
    // freeze RPC 校验 RELEASE_MISMATCH,课堂资产签发按该清单授权(D3')。
    const { error } = await supabase.rpc("freeze_session_courseware", {
      p_session_id: sessionId,
      p_courseware: resolved,
      p_courseware_resolved: selected.release_id
        ? ((await materializeSessionResolved(selected.release_id, selected.track)) as unknown as Json)
        : { version: "cw-session-resolved-v1", track: selected.track, releaseId: null, bindings: [] },
    });
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from("class_sessions")
    .update({ started_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("started_at", null);
  if (error) throw new Error(error.message);
}

export async function endClassSession(sessionId: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("ended_at", null);
  if (error) throw new Error(error.message);
}

export async function setSessionPage(sessionId: string, page: number): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("set_session_authoritative_state", {
    p_session_id: sessionId,
    p_current_page: page,
  });
  if (error) throw new Error(error.message);
}

/** 重新开课：清掉 ended_at 即可回到上课态；事件流里由新的 session_ctl start 收敛各端。 */
export async function reopenClassSession(sessionId: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({ ended_at: null })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
}

/** 上课页初始基线：已入库的课堂事件（离线期间产生的事件在恢复后经 flush 汇入）。 */
export async function listSessionEvents(
  sessionId: string,
  types?: SessionEventType[],
): Promise<SessionEvent[]> {
  const { supabase } = await authenticatedClient();
  let query = supabase
    .from("session_events")
    .select("id,session_id,user_id,device_id,seq,type,payload,at")
    .eq("session_id", sessionId)
    .order("at", { ascending: true })
    .limit(5000);
  if (types && types.length > 0) query = query.in("type", types);
  const { data, error } = await query.returns<
    Array<{ id: string; session_id: string; user_id: string; device_id: string; seq: number; type: SessionEventType; payload: Record<string, unknown>; at: string }>
  >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    deviceId: row.device_id,
    seq: row.seq,
    type: row.type,
    payload: row.payload ?? {},
    at: row.at,
  }));
}

export async function getMyProfileRole(): Promise<"student" | "parent" | "staff" | "admin"> {
  const { supabase, user } = await authenticatedClient();
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: "student" | "parent" | "staff" | "admin" }>();
  return data?.role ?? "student";
}

// ---------------------------------------------------------------------------
// 课堂报告（P4-7）：仅教师可查看；聚合逻辑是纯函数（report.ts），这里只管取数。
// ---------------------------------------------------------------------------

export async function getSessionReport(sessionId: string): Promise<SessionReport> {
  const { supabase, user } = await authenticatedClient();
  const { data: session, error } = await supabase
    .from("class_sessions")
    .select("id,classroom_id")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; classroom_id: string }>();
  if (error) throw new Error(error.message);
  if (!session) throw new Error("NOT_FOUND");
  const { data: myMembership } = await supabase
    .from("classroom_members")
    .select("role")
    .eq("classroom_id", session.classroom_id)
    .eq("user_id", user.id)
    .maybeSingle<{ role: ClassroomRole }>();
  if (myMembership?.role !== "teacher") throw new Error("FORBIDDEN");

  const [{ data: memberRows, error: memberError }, events] = await Promise.all([
    supabase
      .from("classroom_members")
      .select("user_id,role,profiles(display_name)")
      .eq("classroom_id", session.classroom_id)
      .returns<Array<{ user_id: string; role: ClassroomRole; profiles: { display_name: string } | null }>>(),
    listSessionEvents(sessionId, ["star", "star_undo", "hand", "answer", "session_ctl"]),
  ]);
  if (memberError) throw new Error(memberError.message);
  const members: ClassroomMember[] = (memberRows ?? []).map((row) => ({
    userId: row.user_id,
    displayName: row.profiles?.display_name || "",
    role: row.role,
  }));
  return buildSessionReport(members, events);
}

// ---------------------------------------------------------------------------
// 作业（P4-7）：布置/删除走表级 RLS（教师专属，同 class_sessions 模式）；
// 提交/批改一律走 RPC（submit_assignment/grade_submission，见 migration 注释——
// 教师与学生共用 authenticated 角色，列权限拆不开「谁能写哪列」）。
// ---------------------------------------------------------------------------

interface SubmissionRow {
  id: string;
  user_id: string;
  content: AssignmentContent;
  submitted_at: string | null;
  score: number | null;
  feedback: string;
  graded_at: string | null;
}

export async function listAssignments(classroomId: string): Promise<AssignmentMeta[]> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase
    .from("assignments")
    .select("id,classroom_id,title,due_at,created_at")
    .eq("classroom_id", classroomId)
    .order("created_at", { ascending: false })
    .returns<Array<{ id: string; classroom_id: string; title: string; due_at: string | null; created_at: string }>>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    classroomId: row.classroom_id,
    title: row.title,
    dueAt: row.due_at,
    createdAt: row.created_at,
  }));
}

export async function createAssignment(classroomId: string, title: string, text: string, dueAt: string | null): Promise<string> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from("assignments")
    .insert({
      classroom_id: classroomId,
      title: title.trim().slice(0, 100),
      content: { text: text.trim().slice(0, 20000) },
      due_at: dueAt,
      created_by: user.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function deleteAssignment(id: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.from("assignments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getAssignment(id: string): Promise<AssignmentRecord | null> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase
    .from("assignments")
    .select("id,classroom_id,title,content,due_at,created_at")
    .eq("id", id)
    .maybeSingle<{ id: string; classroom_id: string; title: string; content: AssignmentContent; due_at: string | null; created_at: string }>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    classroomId: data.classroom_id,
    title: data.title,
    content: data.content ?? { text: "" },
    dueAt: data.due_at,
    createdAt: data.created_at,
  };
}

/** 教师视角：教室全部学生 + 各自提交（未提交则为空壳记录，id 为空串）。 */
export async function listSubmissions(assignmentId: string): Promise<SubmissionRecord[]> {
  const { supabase } = await authenticatedClient();
  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("classroom_id")
    .eq("id", assignmentId)
    .maybeSingle<{ classroom_id: string }>();
  if (assignmentError) throw new Error(assignmentError.message);
  if (!assignment) return [];
  const [{ data: memberRows, error: memberError }, { data: subRows, error: subError }] = await Promise.all([
    supabase
      .from("classroom_members")
      .select("user_id,profiles(display_name)")
      .eq("classroom_id", assignment.classroom_id)
      .eq("role", "student")
      .returns<Array<{ user_id: string; profiles: { display_name: string } | null }>>(),
    supabase
      .from("submissions")
      .select("id,user_id,content,submitted_at,score,feedback,graded_at")
      .eq("assignment_id", assignmentId)
      .returns<SubmissionRow[]>(),
  ]);
  if (memberError) throw new Error(memberError.message);
  if (subError) throw new Error(subError.message);
  const byUser = new Map((subRows ?? []).map((row) => [row.user_id, row]));
  return (memberRows ?? []).map((member) => {
    const sub = byUser.get(member.user_id);
    return {
      id: sub?.id ?? "",
      userId: member.user_id,
      displayName: member.profiles?.display_name || "",
      content: sub?.content ?? { text: "" },
      submittedAt: sub?.submitted_at ?? null,
      score: sub?.score ?? null,
      feedback: sub?.feedback ?? "",
      gradedAt: sub?.graded_at ?? null,
    };
  });
}

/** 学生视角：自己的提交（未提交则 null）。 */
export async function getMySubmission(assignmentId: string): Promise<SubmissionRecord | null> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from("submissions")
    .select("id,user_id,content,submitted_at,score,feedback,graded_at")
    .eq("assignment_id", assignmentId)
    .eq("user_id", user.id)
    .maybeSingle<SubmissionRow>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    userId: data.user_id,
    displayName: "",
    content: data.content ?? { text: "" },
    submittedAt: data.submitted_at,
    score: data.score,
    feedback: data.feedback,
    gradedAt: data.graded_at,
  };
}

export async function submitAssignment(assignmentId: string, text: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("submit_assignment", {
    p_assignment_id: assignmentId,
    p_content: { text: text.trim().slice(0, 20000) },
  });
  if (error) throw new Error(error.message);
}

export async function gradeSubmission(submissionId: string, score: number | null, feedback: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("grade_submission", {
    p_submission_id: submissionId,
    // pg-meta cannot express a nullable required PostgreSQL function argument;
    // the RPC deliberately accepts NULL to clear a grade.
    p_score: score as number,
    p_feedback: feedback.trim().slice(0, 2000),
  });
  if (error) throw new Error(error.message);
}
