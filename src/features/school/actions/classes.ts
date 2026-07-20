"use server";

// ---------------------------------------------------------------------------
// 建班向导（P4B-3 §9）、报名/转班/退班、课次 CRUD 与班级信息编辑。
// 跨表事实一律走 RPC，Server Action 只做「入参校验 + 权限双闸 + 透传」。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, datetime, intInRange, parse, requiredText, searchQuery, text, uuid } from "./schemas";
import type { BuildClassInput, StudentSearchResult } from "./types";
import type {
  ClassBuildCourseCandidate,
  ClassBuildCourseDetail,
  ClassBuildPurpose,
  ClassBuildScheduleConflict,
} from "../teaching-operations/course-picker-types";

const buildClassSchema = z.object({
  name: requiredText(100),
  courseId: uuid.nullable(),
  capacity: intInRange(1, 500).nullable(),
  room: text(100),
  primaryTeacherId: uuid,
  learningSupportId: uuid.nullable(),
  schoolTermId: uuid,
  purpose: z.enum(["production", "test"]),
  activateNow: z.boolean(),
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
}).superRefine((value, ctx) => {
  if (value.courseId === null && value.sessions.length > 0) {
    ctx.addIssue({ code: "custom", path: ["sessions"], message: "INVALID_SCHEDULE" });
  }
  if (value.learningSupportId !== null && value.learningSupportId === value.primaryTeacherId) {
    ctx.addIssue({ code: "custom", path: ["learningSupportId"], message: "INVALID_STAFF" });
  }
});

const courseSearchSchema = z.object({
  query: searchQuery,
  grade: intInRange(1, 12).nullable(),
  courseSeason: intInRange(1, 4).nullable(),
  classType: text(20),
  purpose: z.enum(["production", "test"]),
});

const classBuildCandidateSchema = z.object({
  id: uuid,
  familyId: uuid,
  familyTitle: z.string(),
  title: z.string(),
  productCode: z.string().nullable(),
  grade: z.number().int(),
  courseSeason: z.number().int(),
  classType: z.string(),
  lectureCount: z.number().int().nonnegative(),
  releasedLectureCount: z.number().int().nonnegative(),
});

const classBuildDetailSchema = classBuildCandidateSchema.extend({
  lectures: z.array(z.object({
    id: uuid,
    no: z.number().int(),
    name: z.string(),
    objectives: z.string(),
    ready: z.boolean(),
  })),
});

const conflictSchema = z.object({
  sessionId: uuid,
  classroomName: z.string(),
  lectureName: z.string(),
  scheduledAt: z.string(),
  durationMin: z.number().int(),
});

type UntypedRpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return supabase.rpc as UntypedRpc;
}

export async function searchClassBuildCoursesAction(input: {
  query: string;
  grade: number | null;
  courseSeason: number | null;
  classType: string;
  purpose: ClassBuildPurpose;
}): Promise<ClassBuildCourseCandidate[]> {
  const value = parse(courseSearchSchema, input);
  const { supabase } = await authorizedClient("class.create");
  const { data, error } = await rpc(supabase)("list_class_build_course_variants", {
    p_query: value.query,
    p_grade: value.grade,
    p_course_season: value.courseSeason,
    p_class_type: value.classType || null,
    p_purpose: value.purpose,
    p_limit: 30,
  });
  if (error) throw new Error(error.message);
  const rows = z.array(z.object({
    course_id: uuid,
    family_id: uuid,
    family_title: z.string(),
    variant_title: z.string(),
    product_code: z.string().nullable(),
    grade: z.number().int(),
    course_season: z.number().int(),
    class_type: z.string(),
    lecture_count: z.number().int().nonnegative(),
    released_lecture_count: z.number().int().nonnegative(),
  })).parse(data ?? []);
  return rows.map((row) => classBuildCandidateSchema.parse({
    id: row.course_id,
    familyId: row.family_id,
    familyTitle: row.family_title,
    title: row.variant_title,
    productCode: row.product_code,
    grade: row.grade,
    courseSeason: row.course_season,
    classType: row.class_type,
    lectureCount: row.lecture_count,
    releasedLectureCount: row.released_lecture_count,
  }));
}

export async function getClassBuildCourseDetailAction(
  courseId: string,
  purpose: ClassBuildPurpose,
): Promise<ClassBuildCourseDetail> {
  const value = parse(z.object({ courseId: uuid, purpose: z.enum(["production", "test"]) }), { courseId, purpose });
  const { supabase } = await authorizedClient("class.create");
  const { data, error } = await rpc(supabase)("get_class_build_course_detail", {
    p_course_id: value.courseId,
    p_purpose: value.purpose,
  });
  if (error) throw new Error(error.message);
  const row = z.object({
    id: uuid,
    familyId: uuid,
    familyTitle: z.string(),
    title: z.string(),
    productCode: z.string().nullable(),
    grade: z.number().int(),
    courseSeason: z.number().int(),
    classType: z.string(),
    lectureCount: z.number().int().nonnegative(),
    releasedLectureCount: z.number().int().nonnegative(),
    lectures: z.array(z.object({
      id: uuid,
      no: z.number().int(),
      name: z.string(),
      objectives: z.string(),
      ready: z.boolean(),
    })),
  }).parse(data);
  return classBuildDetailSchema.parse(row);
}

export async function getClassBuildConflictsAction(
  primaryTeacherId: string,
  slots: Array<{ scheduledAt: string; durationMin: number }>,
): Promise<ClassBuildScheduleConflict[]> {
  const value = parse(z.object({
    primaryTeacherId: uuid,
    slots: z.array(z.object({ scheduledAt: datetime, durationMin: intInRange(1, 600) })).max(200),
  }), { primaryTeacherId, slots });
  const { supabase } = await authorizedClient("class.create");
  const { data, error } = await rpc(supabase)("get_class_build_conflicts", {
    p_primary_teacher_id: value.primaryTeacherId,
    p_slots: value.slots.map((slot) => ({ scheduled_at: slot.scheduledAt, duration_min: slot.durationMin })),
  });
  if (error) throw new Error(error.message);
  const rows = z.array(z.object({
    session_id: uuid,
    classroom_name: z.string(),
    lecture_name: z.string(),
    scheduled_at: z.string(),
    duration_min: z.number().int(),
  })).parse(data ?? []);
  return rows.map((row) => conflictSchema.parse({
    sessionId: row.session_id,
    classroomName: row.classroom_name,
    lectureName: row.lecture_name,
    scheduledAt: row.scheduled_at,
    durationMin: row.duration_min,
  }));
}

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

  const { data: cid, error: rpcError } = await rpc(supabase)("create_class", {
    p_name: value.name,
    p_course_id: value.courseId,
    p_capacity: value.capacity,
    p_room: value.room,
    p_primary_teacher_id: value.primaryTeacherId,
    p_learning_support_id: value.learningSupportId,
    p_term_id: value.schoolTermId,
    p_purpose: value.purpose,
    p_sessions: value.sessions.map((session) => ({
      lecture_id: session.lectureId,
      scheduled_at: session.scheduledAt,
      duration_min: session.durationMin,
    })),
    p_activate: value.activateNow,
  });
  if (rpcError) throw new Error(rpcError.message);
  return parse(uuid, cid);
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

// P4H-2：取消/恢复课次只走受控 RPC，保留历史事件而不发生物理删除。
const cancelSessionSchema = z.object({ sessionId: uuid, reason: text(1000) });

export async function deleteUnstartedSessionAction(sessionId: string, reason = ""): Promise<ActionResult> {
  try {
    const value = parse(cancelSessionSchema, { sessionId, reason });
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await supabase.rpc("cancel_session", {
      p_session_id: value.sessionId,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SCOPED_CODES);
  }
}

export async function restoreSessionAction(sessionId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, sessionId);
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await supabase.rpc("restore_session", { p_session_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SCOPED_CODES);
  }
}

export async function archiveClassroomAction(classroomId: string, archived: boolean): Promise<void> {
  const value = parse(z.object({ classroomId: uuid, archived: z.boolean() }), { classroomId, archived });
  const { supabase } = await authorizedClient("class.manage");
  const { error } = await supabase.rpc("archive_classroom", {
    p_classroom_id: value.classroomId,
    p_archived: value.archived,
  });
  if (error) throw new Error(error.message);
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
