"use server";

// ---------------------------------------------------------------------------
// 建班向导（P4B-3 §9）、报名/转班/退班、课次 CRUD 与班级信息编辑。
// 跨表事实一律走 RPC，Server Action 只做「入参校验 + 权限双闸 + 透传」。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { initialOverlayFromTemplate, type CoursewareTemplatePage } from "../courseware-overlay";
import { authorizedClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, datetime, intInRange, parse, requiredText, searchQuery, text, uuid } from "./schemas";
import type { BuildClassInput, StudentSearchResult } from "./types";

const buildClassSchema = z.object({
  name: requiredText(100),
  courseId: uuid.nullable(),
  grade: intInRange(1, 12).nullable(),
  capacity: intInRange(1, 500).nullable(),
  room: text(100),
  teacherId: uuid,
  sessions: z
    .array(
      z.object({
        lectureId: uuid,
        no: intInRange(1, 999),
        name: text(100),
        scheduledAt: datetime,
        durationMin: intInRange(1, 600),
      }),
    )
    .max(200),
});

const coursewareTrackSchema = z.enum(["native-16x9", "adapted-4x3"]);

export async function setClassroomCoursewareTrackAction(
  classroomId: string,
  track: z.infer<typeof coursewareTrackSchema>,
): Promise<ActionResult> {
  try {
    const value = parse(z.object({ classroomId: uuid, track: coursewareTrackSchema }), { classroomId, track });
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await supabase.rpc("set_classroom_courseware_track", {
      p_classroom_id: value.classroomId,
      p_track: value.track,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["CLASSROOM_NOT_FOUND", "INVALID_COURSEWARE_TRACK", ...COMMON_CODES]);
  }
}

export async function setSessionCoursewareTrackOverrideAction(
  sessionId: string,
  track: z.infer<typeof coursewareTrackSchema> | null,
): Promise<ActionResult> {
  try {
    const value = parse(z.object({ sessionId: uuid, track: coursewareTrackSchema.nullable() }), { sessionId, track });
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await supabase.rpc("set_session_courseware_track_override", {
      p_session_id: value.sessionId,
      p_track: nullableRpcArg(value.track),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "ALREADY_STARTED_OR_FROZEN", "INVALID_COURSEWARE_TRACK", ...COMMON_CODES]);
  }
}

export async function buildClass(input: BuildClassInput): Promise<string> {
  const value = parse(buildClassSchema, input);
  const { supabase } = await authorizedClient("class.create");

  const { data: cid, error: rpcError } = await supabase.rpc("create_class", {
    p_name: value.name,
    p_course_id: value.courseId ?? undefined,
    p_grade: value.grade ?? undefined,
    p_capacity: value.capacity ?? undefined,
    p_room: value.room,
    p_teacher_id: value.teacherId,
  });
  if (rpcError) throw new Error(rpcError.message);
  const classroomId = cid as string;

  if (value.sessions.length === 0) return classroomId;

  const lectureIds = value.sessions.map((session) => session.lectureId);
  const { data: lectureRows, error: lectureError } = await supabase
    .from("course_lectures")
    .select("id,courseware_template")
    .in("id", lectureIds)
    .returns<Array<{ id: string; courseware_template: CoursewareTemplatePage[] }>>();
  if (lectureError) throw new Error(lectureError.message);
  const templateById = new Map((lectureRows ?? []).map((row) => [row.id, row.courseware_template ?? []]));

  const rows = value.sessions.map((session) => ({
    classroom_id: classroomId,
    lecture_id: session.lectureId,
    lecture_no: session.no,
    title: session.name,
    scheduled_at: session.scheduledAt,
    duration_min: session.durationMin,
    courseware: [],
    courseware_overlay: initialOverlayFromTemplate(templateById.get(session.lectureId) ?? []),
  }));

  const { error: insertError } = await supabase.from("class_sessions").insert(rows);
  if (insertError) throw new Error(insertError.message);

  return classroomId;
}

const enrollSchema = z.object({ classroomId: uuid, studentId: uuid, remark: text(500) });

export async function enrollStudentAction(classroomId: string, studentId: string, remark: string): Promise<ActionResult> {
  try {
    const value = parse(enrollSchema, { classroomId, studentId, remark });
    const { supabase } = await authorizedClient("enrollment.manage");
    const { error } = await supabase.rpc("enroll_student", {
      p_classroom_id: value.classroomId,
      p_student_id: value.studentId,
      p_remark: value.remark,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

const transferSchema = z.object({ studentId: uuid, fromClassroomId: uuid, toClassroomId: uuid, remark: text(500) });

export async function transferStudentAction(
  studentId: string,
  fromClassroomId: string,
  toClassroomId: string,
  remark: string,
): Promise<ActionResult> {
  try {
    const value = parse(transferSchema, { studentId, fromClassroomId, toClassroomId, remark });
    const { supabase } = await authorizedClient("enrollment.manage");
    const { error } = await supabase.rpc("transfer_student", {
      p_student_id: value.studentId,
      p_from_classroom: value.fromClassroomId,
      p_to_classroom: value.toClassroomId,
      p_remark: value.remark,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

const withdrawSchema = z.object({ enrollmentId: uuid, remark: text(500) });

export async function withdrawStudentAction(enrollmentId: string, remark: string): Promise<ActionResult> {
  try {
    const value = parse(withdrawSchema, { enrollmentId, remark });
    const { supabase } = await authorizedClient("enrollment.manage");
    const { error } = await supabase.rpc("withdraw_student", {
      p_enrollment_id: value.enrollmentId,
      p_remark: value.remark,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

// class.manage 只是全局功能闸；行级作用域（本人任教 vs 全局）靠 RLS 收窄。
// 跨作用域操作时 RLS 会让 update/delete 静默命中 0 行而不报错，前端会误以为成功——
// 这里额外 select 受影响行数，0 行时改抛 FORBIDDEN_SCOPE（10-§7 代码审查发现）。
const SCOPED_CODES = ["FORBIDDEN_SCOPE", ...COMMON_CODES] as const;

const rescheduleSchema = z.object({ sessionId: uuid, scheduledAt: datetime, durationMin: intInRange(1, 600) });

export async function rescheduleSessionAction(sessionId: string, scheduledAt: string, durationMin: number): Promise<ActionResult> {
  try {
    const value = parse(rescheduleSchema, { sessionId, scheduledAt, durationMin });
    const { supabase } = await authorizedClient("class.manage");
    const { data, error } = await supabase
      .from("class_sessions")
      .update({ scheduled_at: value.scheduledAt, duration_min: value.durationMin })
      .eq("id", value.sessionId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("FORBIDDEN_SCOPE");
    return { ok: true };
  } catch (error) {
    return actionError(error, SCOPED_CODES);
  }
}

const substituteSchema = z.object({ sessionId: uuid, teacherId: uuid.nullable(), reason: text(1000) });

export async function assignSessionSubstituteAction(sessionId: string, teacherId: string | null, reason: string): Promise<ActionResult> {
  try {
    const value = parse(substituteSchema, { sessionId, teacherId, reason });
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await supabase.rpc("assign_session_substitute", {
      p_session_id: value.sessionId,
      p_teacher_id: nullableRpcArg(value.teacherId),
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

export async function listSubstituteTeachersAction(sessionId: string): Promise<Array<{ id: string; name: string }>> {
  const id = parse(uuid, sessionId);
  const { supabase } = await authorizedClient("class.manage");
  const { data, error } = await supabase.rpc("list_substitute_candidates", { p_session_id: id });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; display_name: string }>).map((row) => ({ id: row.id, name: row.display_name }));
}

// 软删（P4C-2 §7）：不物理 delete，置 deleted_at；未开始且未删的课次才可删。
export async function deleteUnstartedSessionAction(sessionId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, sessionId);
    const { supabase } = await authorizedClient("class.manage");
    const { data, error } = await supabase
      .from("class_sessions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("started_at", null)
      .is("deleted_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("FORBIDDEN_SCOPE");
    return { ok: true };
  } catch (error) {
    return actionError(error, SCOPED_CODES);
  }
}

export async function restoreSessionAction(sessionId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, sessionId);
    const { supabase } = await authorizedClient("class.manage");
    const { data, error } = await supabase
      .from("class_sessions")
      .update({ deleted_at: null })
      .eq("id", id)
      .not("deleted_at", "is", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("FORBIDDEN_SCOPE");
    return { ok: true };
  } catch (error) {
    return actionError(error, SCOPED_CODES);
  }
}

export async function archiveClassroomAction(classroomId: string, archived: boolean): Promise<void> {
  const value = parse(z.object({ classroomId: uuid, archived: z.boolean() }), { classroomId, archived });
  const { supabase } = await authorizedClient("class.manage");
  const { data, error } = await supabase
    .from("classrooms")
    .update({ archived_at: value.archived ? new Date().toISOString() : null })
    .eq("id", value.classroomId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("FORBIDDEN_SCOPE");
}

const updateClassroomSchema = z.object({
  classroomId: uuid,
  name: requiredText(100),
  capacity: intInRange(1, 500).nullable(),
  room: text(100),
  grade: intInRange(1, 12).nullable(),
});

export async function updateClassroomAction(
  classroomId: string,
  input: { name: string; capacity: number | null; room: string; grade: number | null },
): Promise<ActionResult> {
  try {
    const value = parse(updateClassroomSchema, { classroomId, ...input });
    const { supabase } = await authorizedClient("class.manage");
    const { data, error } = await supabase
      .from("classrooms")
      .update({ name: value.name, capacity: value.capacity, room: value.room, grade: value.grade })
      .eq("id", value.classroomId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("FORBIDDEN_SCOPE");
    return { ok: true };
  } catch (error) {
    return actionError(error, SCOPED_CODES);
  }
}

// ---------------------------------------------------------------------------
// 花名册辅助：报名对话框的学生搜索、转班对话框的目标班级下拉
// ---------------------------------------------------------------------------

/** ilike 的 % _ \ 是通配符，用户搜索串里出现时必须转义，否则一个 `%` 就能拉全表。 */
function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export async function searchStudentsForEnroll(query: string): Promise<StudentSearchResult[]> {
  const trimmed = parse(searchQuery, query);
  const { supabase } = await authorizedClient("enrollment.manage");
  if (!trimmed) return [];
  const { data, error } = await supabase
    .from("students")
    .select("id,name,grade,status")
    .is("deleted_at", null)
    .ilike("name", `%${escapeLike(trimmed)}%`)
    .limit(10)
    .returns<StudentSearchResult[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listClassroomOptions(excludeId?: string): Promise<Array<{ id: string; name: string }>> {
  const exclude = excludeId ? parse(uuid, excludeId) : undefined;
  const { supabase } = await authorizedClient("enrollment.manage");
  let query = supabase.from("classrooms").select("id,name").is("archived_at", null).order("name", { ascending: true }).limit(200);
  if (exclude) query = query.neq("id", exclude);
  const { data, error } = await query.returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, name: row.name || "-" }));
}
