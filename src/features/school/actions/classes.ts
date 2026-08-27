"use server";

// ---------------------------------------------------------------------------
// 建班向导（P4B-3 §9）、报名/转班/退班、课次 CRUD 与班级信息编辑。
// 跨表事实一律走 RPC，Server Action 只做「入参校验 + 权限双闸 + 透传」。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import { materializeSessionResolved } from "@/features/courseware-studio/data";
import { getSessionCoursewareTemplate } from "../courses";
import { resolveCourseware, type OverlaySlot } from "../courseware-overlay";
import { authorizedClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, datetime, intInRange, parse, requiredText, searchQuery, text, uuid } from "./schemas";
import type { BuildClassInput, StudentSearchResult } from "./types";
import type {
  ClassBuildCourseCandidate,
  ClassBuildCourseDetail,
  ClassBuildMicrocourseTopic,
  ClassBuildPurpose,
  ClassBuildScheduleConflict,
} from "../teaching-operations/course-picker-types";
import { buildClassSchema } from "./class-build-schema";

const courseSearchSchema = z.object({
  query: searchQuery,
  grade: intInRange(1, 12).nullable(),
  courseSeason: intInRange(1, 4).nullable(),
  classType: text(20),
  purpose: z.enum(["production", "test"]),
  includeSuperseded: z.boolean().default(false),
  courseKind: z.enum(["curriculum", "microcourse"]).nullable().default(null),
  authorId: uuid.nullable().default(null),
  primaryTopicSlug: text(60),
  keyword: text(32),
});

const classBuildCandidateSchema = z.object({
  id: uuid,
  familyId: uuid,
  familyTitle: z.string(),
  title: z.string(),
  productCode: z.string().nullable(),
  catalogVersionSlug: z.string(),
  catalogVersionTitle: z.string(),
  isSuperseded: z.boolean(),
  grade: z.number().int(),
  courseSeason: z.number().int().nullable(),
  classType: z.string(),
  lectureCount: z.number().int().nonnegative(),
  releasedLectureCount: z.number().int().nonnegative(),
  courseKind: z.enum(["curriculum", "microcourse"]),
  authorId: uuid.nullable(),
  authorName: z.string().nullable(),
  primaryTopicSlug: z.string().nullable(),
  primaryTopicTitleZh: z.string().nullable(),
  primaryTopicTitleEn: z.string().nullable(),
  keywords: z.array(z.string()),
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

const classBuildMicrocourseTopicSchema = z.object({
  id: uuid,
  slug: z.string(),
  title_zh: z.string(),
  title_en: z.string(),
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
  return (supabase.rpc as UntypedRpc).bind(supabase);
}

type CourseCatalogPermission = "class.create" | "courseware.microcourse.author";
type CourseSearchValue = z.infer<typeof courseSearchSchema>;

async function searchCourseVariants(
  value: CourseSearchValue,
  permission: CourseCatalogPermission,
): Promise<ClassBuildCourseCandidate[]> {
  const { supabase } = await authorizedClient(permission);
  const { data, error } = await rpc(supabase)("list_class_build_course_variants", {
    p_query: value.query,
    p_grade: value.grade,
    p_course_season: value.courseSeason,
    p_class_type: value.classType || null,
    p_purpose: value.purpose,
    p_limit: 30,
    p_include_superseded: value.includeSuperseded,
    p_course_kind: value.courseKind,
    p_author_id: value.authorId,
    p_primary_topic_slug: value.primaryTopicSlug || null,
    p_keyword: value.keyword || null,
  });
  if (error) throw new Error(error.message);
  const rows = z.array(z.object({
    course_id: uuid,
    family_id: uuid,
    family_title: z.string(),
    variant_title: z.string(),
    product_code: z.string().nullable(),
    catalog_version_slug: z.string(),
    catalog_version_title: z.string(),
    is_superseded: z.boolean(),
    grade: z.number().int(),
    course_season: z.number().int().nullable(),
    class_type: z.string(),
    lecture_count: z.number().int().nonnegative(),
    released_lecture_count: z.number().int().nonnegative(),
    course_kind: z.enum(["curriculum", "microcourse"]),
    author_id: uuid.nullable(),
    author_name: z.string().nullable(),
    primary_topic_slug: z.string().nullable(),
    primary_topic_title_zh: z.string().nullable(),
    primary_topic_title_en: z.string().nullable(),
    keywords: z.array(z.string()).nullable(),
  })).parse(data ?? []);
  return rows.map((row) => classBuildCandidateSchema.parse({
    id: row.course_id,
    familyId: row.family_id,
    familyTitle: row.family_title,
    title: row.variant_title,
    productCode: row.product_code,
    catalogVersionSlug: row.catalog_version_slug,
    catalogVersionTitle: row.catalog_version_title,
    isSuperseded: row.is_superseded,
    grade: row.grade,
    courseSeason: row.course_season,
    classType: row.class_type,
    lectureCount: row.lecture_count,
    releasedLectureCount: row.released_lecture_count,
    courseKind: row.course_kind,
    authorId: row.author_id,
    authorName: row.author_name,
    primaryTopicSlug: row.primary_topic_slug,
    primaryTopicTitleZh: row.primary_topic_title_zh,
    primaryTopicTitleEn: row.primary_topic_title_en,
    keywords: row.keywords ?? [],
  }));
}

export async function searchClassBuildCoursesAction(input: {
  query: string;
  grade: number | null;
  courseSeason: number | null;
  classType: string;
  purpose: ClassBuildPurpose;
  includeSuperseded?: boolean;
  courseKind?: "curriculum" | "microcourse" | null;
  authorId?: string | null;
  primaryTopicSlug?: string;
  keyword?: string;
}): Promise<ClassBuildCourseCandidate[]> {
  const value = parse(courseSearchSchema, input);
  return searchCourseVariants(value, "class.create");
}

export async function searchTeacherMicrocourseSourceCoursesAction(input: {
  query: string;
  grade: number | null;
  courseSeason: number | null;
  classType: string;
  purpose: ClassBuildPurpose;
  includeSuperseded?: boolean;
  courseKind?: "curriculum" | "microcourse" | null;
  authorId?: string | null;
  primaryTopicSlug?: string;
  keyword?: string;
}): Promise<ClassBuildCourseCandidate[]> {
  const value = parse(courseSearchSchema, input);
  if (value.purpose !== "production"
      || value.courseKind !== "curriculum"
      || value.authorId !== null
      || value.primaryTopicSlug !== ""
      || value.keyword !== "") {
    throw new Error("VALIDATION");
  }
  return searchCourseVariants(value, "courseware.microcourse.author");
}

export async function listClassBuildMicrocourseTopicsAction(): Promise<ClassBuildMicrocourseTopic[]> {
  const { supabase } = await authorizedClient("class.create");
  const { data, error } = await rpc(supabase)("list_teacher_microcourse_topics", {});
  if (error) throw new Error(error.message);
  return z.array(classBuildMicrocourseTopicSchema).parse(data ?? []).map((topic) => ({
    id: topic.id,
    slug: topic.slug,
    titleZh: topic.title_zh,
    titleEn: topic.title_en,
  }));
}

async function getCourseCatalogDetail(
  courseId: string,
  purpose: ClassBuildPurpose,
  permission: CourseCatalogPermission,
): Promise<ClassBuildCourseDetail> {
  const value = parse(z.object({ courseId: uuid, purpose: z.enum(["production", "test"]) }), { courseId, purpose });
  const { supabase } = await authorizedClient(permission);
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
    catalogVersionSlug: z.string(),
    catalogVersionTitle: z.string(),
    isSuperseded: z.boolean(),
    grade: z.number().int(),
    courseSeason: z.number().int().nullable(),
    classType: z.string(),
    lectureCount: z.number().int().nonnegative(),
    releasedLectureCount: z.number().int().nonnegative(),
    courseKind: z.enum(["curriculum", "microcourse"]),
    authorId: uuid.nullable(),
    authorName: z.string().nullable(),
    primaryTopicSlug: z.string().nullable(),
    primaryTopicTitleZh: z.string().nullable(),
    primaryTopicTitleEn: z.string().nullable(),
    keywords: z.array(z.string()).nullable(),
    lectures: z.array(z.object({
      id: uuid,
      no: z.number().int(),
      name: z.string(),
      objectives: z.string(),
      ready: z.boolean(),
    })),
  }).parse(data);
  return classBuildDetailSchema.parse({ ...row, keywords: row.keywords ?? [] });
}

export async function getClassBuildCourseDetailAction(
  courseId: string,
  purpose: ClassBuildPurpose,
): Promise<ClassBuildCourseDetail> {
  return getCourseCatalogDetail(courseId, purpose, "class.create");
}

export async function getTeacherMicrocourseSourceCourseDetailAction(
  courseId: string,
  purpose: ClassBuildPurpose,
): Promise<ClassBuildCourseDetail> {
  if (purpose !== "production") throw new Error("VALIDATION");
  return getCourseCatalogDetail(courseId, purpose, "courseware.microcourse.author");
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

  const sessions = value.sessions.map((session) => ({
    lecture_id: session.lectureId,
    title: session.name,
    scheduled_at: session.scheduledAt,
    duration_min: session.durationMin,
  }));
  const { data: cid, error: rpcError } = value.courseId === null
    ? await rpc(supabase)("create_free_class_with_sessions", {
        p_name: value.name,
        p_capacity: value.capacity,
        p_room: value.room,
        p_primary_teacher_id: value.primaryTeacherId,
        p_learning_support_id: value.learningSupportId,
        p_term_id: value.schoolTermId,
        p_purpose: value.purpose,
        p_sessions: sessions,
        p_activate: value.activateNow,
      })
    : await rpc(supabase)("create_class", {
        p_name: value.name,
        p_course_id: value.courseId,
        p_capacity: value.capacity,
        p_room: value.room,
        p_primary_teacher_id: value.primaryTeacherId,
        p_learning_support_id: value.learningSupportId,
        p_term_id: value.schoolTermId,
        p_purpose: value.purpose,
        p_sessions: sessions,
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

const managedSessionSchema = z.object({
  title: requiredText(100),
  scheduledAt: datetime,
  durationMin: intInRange(1, 600),
});

const MANAGED_SESSION_CODES = [
  "FORBIDDEN_SCOPE",
  "CLASSROOM_NOT_FOUND",
  "CLASSROOM_REQUIRES_LECTURE",
  "CLASSROOM_NOT_ACTIVE",
  "SESSION_NOT_FOUND",
  "SESSION_ALREADY_STARTED",
  "SESSION_NOT_EDITABLE",
  ...COMMON_CODES,
] as const;

export async function createClassSessionAction(
  classroomId: string,
  input: { title: string; scheduledAt: string; durationMin: number },
): Promise<ActionResult<{ id: string }>> {
  try {
    const value = parse(managedSessionSchema.extend({ classroomId: uuid }), { classroomId, ...input });
    const supabase = await createClient();
    const { data, error } = await rpc(supabase)("create_managed_class_session", {
      p_classroom_id: value.classroomId,
      p_title: value.title,
      p_scheduled_at: value.scheduledAt,
      p_duration_min: value.durationMin,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { id: parse(uuid, data) } };
  } catch (error) {
    return actionError<{ id: string }>(error, MANAGED_SESSION_CODES);
  }
}

export async function updateClassSessionAction(
  sessionId: string,
  input: { title: string; scheduledAt: string; durationMin: number },
): Promise<ActionResult> {
  try {
    const value = parse(managedSessionSchema.extend({ sessionId: uuid }), { sessionId, ...input });
    const supabase = await createClient();
    const { error } = await rpc(supabase)("update_managed_class_session", {
      p_session_id: value.sessionId,
      p_title: value.title,
      p_scheduled_at: value.scheduledAt,
      p_duration_min: value.durationMin,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, MANAGED_SESSION_CODES);
  }
}

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

// P4H-8：作废课次是 session.void 专属功能键（目前只授予 principal），与 class.manage 的
// 取消/恢复分开授权，不能复用 SCOPED_CODES 的 authorizedClient 闸。
const voidSessionSchema = z.object({ sessionId: uuid, reason: text(1000) });

export async function voidSessionAction(sessionId: string, reason = ""): Promise<ActionResult> {
  try {
    const value = parse(voidSessionSchema, { sessionId, reason });
    const { supabase } = await authorizedClient("session.void");
    const { error } = await supabase.rpc("void_session", {
      p_session_id: value.sessionId,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["FORBIDDEN_SCOPE", "SESSION_NOT_ENDED", "SESSION_ALREADY_VOIDED", ...COMMON_CODES]);
  }
}

// P4I-13：班级生命周期（archive_classroom/transition_classroom_status/trash_classroom/
// restore_classroom）迁移期就已完整实现，本次是首次接 Server Action + UI（设置 Sheet）。
// archive_classroom 此前零消费者、返回 void 且不捕获异常，一并改成 ActionResult 与其余三个一致。
const LIFECYCLE_CODES = [
  "FORBIDDEN_SCOPE",
  "CLASSROOM_NOT_FOUND",
  "INVALID_TRANSITION",
  "CLASSROOM_HAS_ACTIVE_ENROLLMENTS",
  "CLASSROOM_HAS_HISTORY",
  ...COMMON_CODES,
] as const;

const transitionClassroomStatusSchema = z.object({
  classroomId: uuid,
  target: z.enum(["planning", "active", "completed"]),
});

export async function transitionClassroomStatusAction(
  classroomId: string,
  target: "planning" | "active" | "completed",
): Promise<ActionResult> {
  try {
    const value = parse(transitionClassroomStatusSchema, { classroomId, target });
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await supabase.rpc("transition_classroom_status", {
      p_classroom_id: value.classroomId,
      p_target: value.target,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, LIFECYCLE_CODES);
  }
}

export async function trashClassroomAction(classroomId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, classroomId);
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await supabase.rpc("trash_classroom", { p_classroom_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, LIFECYCLE_CODES);
  }
}

export async function restoreClassroomAction(classroomId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, classroomId);
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await supabase.rpc("restore_classroom", { p_classroom_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, LIFECYCLE_CODES);
  }
}

export async function archiveClassroomAction(classroomId: string, archived: boolean): Promise<ActionResult> {
  try {
    const value = parse(z.object({ classroomId: uuid, archived: z.boolean() }), { classroomId, archived });
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await supabase.rpc("archive_classroom", {
      p_classroom_id: value.classroomId,
      p_archived: value.archived,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, LIFECYCLE_CODES);
  }
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

// ---------------------------------------------------------------------------
// P4I-14：课次工作区备课编排（开始/复制/完成备课）与课后任务/完成本次课。
// 备课相关权限闸统一用 courseware.overlay.edit（teacher/principal 持有，语义上
// "本次覆盖" 就是这个权限键管的对象），真正的作用域仍由各 RPC 内部
// is_session_teacher 收窄；courseware.overlay.edit 只挡"完全无关的登录用户"。
// ---------------------------------------------------------------------------

const PREP_CODES = [
  "SESSION_NOT_FOUND", "ALREADY_STARTED", "TRACK_MISMATCH", "RELEASE_MISMATCH",
  "LECTURE_MISMATCH", "SOURCE_PREPARATION_NOT_FOUND", "NO_LECTURE",
  "COURSEWARE_TRACK_NOT_RESOLVED", "INVALID_COURSEWARE_FREEZE",
  ...COMMON_CODES,
] as const;

export async function startSessionPreparationAction(sessionId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, sessionId);
    const { supabase } = await authorizedClient("courseware.overlay.edit");
    const { error } = await supabase.rpc("start_session_preparation", { p_session_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, PREP_CODES);
  }
}

export interface SessionPrepCopyCandidate {
  sessionId: string;
  classroomName: string;
  scheduledAt: string | null;
  track: string | null;
  releaseNo: number | null;
}

export async function listSessionPreparationCopyCandidatesAction(sessionId: string): Promise<ActionResult<SessionPrepCopyCandidate[]>> {
  try {
    const id = parse(uuid, sessionId);
    const { supabase } = await authorizedClient("courseware.overlay.edit");
    const { data, error } = await supabase.rpc("list_session_preparation_copy_candidates", { p_session_id: id });
    if (error) throw new Error(error.message);
    const rows = z.array(z.object({
      session_id: uuid,
      classroom_name: z.string(),
      scheduled_at: z.string().nullable(),
      track: z.string().nullable(),
      release_no: z.number().int().nullable(),
    })).parse(data ?? []);
    return {
      ok: true,
      data: rows.map((row) => ({
        sessionId: row.session_id,
        classroomName: row.classroom_name,
        scheduledAt: row.scheduled_at,
        track: row.track,
        releaseNo: row.release_no,
      })),
    };
  } catch (error) {
    return actionError<SessionPrepCopyCandidate[]>(error, PREP_CODES);
  }
}

export async function copySessionPreparationAction(sessionId: string, fromSessionId: string): Promise<ActionResult> {
  try {
    const value = parse(z.object({ sessionId: uuid, fromSessionId: uuid }), { sessionId, fromSessionId });
    const { supabase } = await authorizedClient("courseware.overlay.edit");
    const { error } = await supabase.rpc("copy_session_preparation", {
      p_session_id: value.sessionId,
      p_from_session_id: value.fromSessionId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, PREP_CODES);
  }
}

const completePrepSchema = z.object({ sessionId: uuid });

/**
 * 完成备课/更新 release 编排（.claude/p4i-0-baseline.md「P4I-14 执行记录」记录的调用顺序）：
 * resolve_session_courseware_release → TS 层 resolveCourseware 合并 → materializeSessionResolved →
 * save_session_prepared_courseware（只要 started_at 仍为空就能重复调用，同一个函数服务
 * "完成备课"首次调用和"更新 release"后续调用）。无 release 时冻结空白/本次覆盖
 * 快照；备课产物、审核和检查项继续显示质量状态，但不阻断教师确认。
 */
export async function completeSessionPreparationAction(sessionId: string): Promise<ActionResult> {
  try {
    const value = parse(completePrepSchema, { sessionId });
    const { supabase } = await authorizedClient("courseware.overlay.edit");

    const { data: session, error: sessionError } = await supabase
      .from("class_sessions")
      .select("lecture_id,courseware_overlay")
      .eq("id", value.sessionId)
      .maybeSingle<{ lecture_id: string | null; courseware_overlay: OverlaySlot[] }>();
    if (sessionError) throw new Error(sessionError.message);
    if (!session) throw new Error("SESSION_NOT_FOUND");

    const { data: resolvedRows, error: resolveError } = await supabase.rpc("resolve_session_courseware_release", {
      p_session_id: value.sessionId,
    });
    if (resolveError) throw new Error(resolveError.message);
    const resolved = (resolvedRows?.[0] ?? null) as { track: "native-16x9" | "adapted-4x3"; release_id: string | null } | null;
    if (!resolved) throw new Error("COURSEWARE_TRACK_NOT_RESOLVED");

    const template = await getSessionCoursewareTemplate(value.sessionId);
    const merged = resolveCourseware(template, session.courseware_overlay ?? []);
    const resolvedMeta = resolved.release_id
      ? await materializeSessionResolved(resolved.release_id, resolved.track)
      : { version: "cw-session-resolved-v1" as const, track: resolved.track, releaseId: null, bindings: [], learningCheckPages: [] };

    const { error: saveError } = await supabase.rpc("save_session_prepared_courseware", {
      p_session_id: value.sessionId,
      p_courseware: merged as unknown as Json,
      p_courseware_resolved: resolvedMeta as unknown as Json,
    });
    if (saveError) throw new Error(saveError.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, PREP_CODES);
  }
}

const completeTaskSchema = z.object({ taskId: uuid, status: z.enum(["done", "skipped"]), note: text(1000) });

/**
 * 通用"标记完成/跳过"；每类任务的专用表单（点名网格/课评撰写等）留给 P4I-15，
 * 这里不加外层权限闸——complete_session_task 内部按 kind 分派到各自的精确权限
 * （attendance.mark/can_review_session/is_classroom_teacher/can_review_video_session/
 * followup.write），套一个统一 authorizedClient(key) 反而会误伤持有其他 kind 权限的
 * 合法责任人。
 */
export async function completeSessionTaskAction(taskId: string, status: "done" | "skipped", note = ""): Promise<ActionResult> {
  try {
    const value = parse(completeTaskSchema, { taskId, status, note });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const { error } = await supabase.rpc("complete_session_task", {
      p_task_id: value.taskId,
      p_status: value.status,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["TASK_NOT_FOUND", "TASK_ALREADY_COMPLETED", "SKIP_REASON_REQUIRED", "INVALID_STATUS", "FORBIDDEN", ...COMMON_CODES]);
  }
}

export async function completeSessionPostworkAction(sessionId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, sessionId);
    const { supabase } = await authorizedClient("session.postwork.manage");
    const { error } = await supabase.rpc("complete_class_session_postwork", { p_session_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "TASKS_NOT_COMPLETE", "FORBIDDEN", ...COMMON_CODES]);
  }
}

export async function reopenSessionPostworkAction(sessionId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, sessionId);
    const { supabase } = await authorizedClient("session.postwork.manage");
    const { error } = await supabase.rpc("reopen_class_session_postwork", { p_session_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "NOT_COMPLETED", "FORBIDDEN", ...COMMON_CODES]);
  }
}

// ---------------------------------------------------------------------------
// P4I-15：请假审批、支持任务逐人明细、家庭摘要发布入口。
// ---------------------------------------------------------------------------

const decideLeaveRequestSchema = z.object({ requestId: uuid, approve: z.boolean() });

/**
 * 不加 authorizedClient(singleKey)：decide_session_leave_request 内部用
 * can_mark_attendance 校验，套一个统一权限键反而多此一举——鉴权交给 RPC。
 */
export async function decideSessionLeaveRequestAction(requestId: string, approve: boolean): Promise<ActionResult> {
  try {
    const value = parse(decideLeaveRequestSchema, { requestId, approve });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const { error } = await supabase.rpc("decide_session_leave_request", { p_request_id: value.requestId, p_approve: value.approve });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["REQUEST_NOT_FOUND", "REQUEST_ALREADY_DECIDED", "FORBIDDEN", ...COMMON_CODES]);
  }
}

const updateRecipientSchema = z.object({
  recipientId: uuid,
  status: z.enum(["sent", "confirmed", "failed", "waived"]),
  note: text(1000),
});

export async function updateSupportTaskRecipientAction(recipientId: string, status: "sent" | "confirmed" | "failed" | "waived", note = ""): Promise<ActionResult> {
  try {
    const value = parse(updateRecipientSchema, { recipientId, status, note });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const { error } = await supabase.rpc("update_support_task_recipient", {
      p_recipient_id: value.recipientId,
      p_status: value.status,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["RECIPIENT_NOT_FOUND", "INVALID_TRANSITION", "FORBIDDEN", ...COMMON_CODES]);
  }
}

const familyBriefSchema = z.object({
  sessionId: uuid,
  lessonTitle: text(200),
  learningSummary: text(2000),
  homeworkSummary: text(2000),
  materialsNote: text(2000),
  teacherPublicComment: text(2000),
});

export async function saveSessionFamilyBriefAction(input: {
  sessionId: string;
  lessonTitle: string;
  learningSummary: string;
  homeworkSummary: string;
  materialsNote: string;
  teacherPublicComment: string;
}): Promise<ActionResult> {
  try {
    const value = parse(familyBriefSchema, input);
    const { supabase } = await authorizedClient("review.write");
    const { error } = await supabase.rpc("save_session_family_brief", {
      p_session_id: value.sessionId,
      p_lesson_title: value.lessonTitle,
      p_learning_summary: value.learningSummary,
      p_homework_summary: value.homeworkSummary,
      p_materials_note: value.materialsNote,
      p_teacher_public_comment: value.teacherPublicComment,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "FORBIDDEN", ...COMMON_CODES]);
  }
}

const knowledgeSummaryDocumentSchema = z.object({
  sessionId: uuid,
  lessonTitle: text(200),
  document: z.array(z.unknown()).max(1000).refine((value) => {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 1_048_576;
    } catch {
      return false;
    }
  }),
  templateVersion: requiredText(100),
  baseRevision: z.number().int().nonnegative(),
});

function documentPlainText(document: unknown[]) {
  const parts: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    if (typeof row.text === "string" && row.text.trim()) parts.push(row.text.trim());
    if (Array.isArray(row.content)) visit(row.content);
    if (Array.isArray(row.children)) visit(row.children);
  };
  visit(document);
  return parts.join("\n").slice(0, 50_000);
}

export interface SaveSessionKnowledgeSummaryInput {
  sessionId: string;
  lessonTitle: string;
  document: unknown[];
  templateVersion: string;
  baseRevision: number;
}

export async function saveSessionKnowledgeSummaryAction(
  input: SaveSessionKnowledgeSummaryInput,
): Promise<ActionResult<{ revision: number; status: string }>> {
  try {
    const value = parse(knowledgeSummaryDocumentSchema, input);
    const { supabase } = await authorizedClient("review.write");
    const { data, error } = await supabase.rpc("save_session_knowledge_summary", {
      p_session_id: value.sessionId,
      p_lesson_title: value.lessonTitle,
      p_document: value.document as Json,
      p_template_version: value.templateVersion,
      p_base_revision: value.baseRevision,
      p_plain_text: documentPlainText(value.document),
    });
    if (error) throw new Error(error.message);
    const result = data?.[0];
    if (!result) throw new Error("RESULT_NOT_FOUND");
    return {
      ok: true,
      data: { revision: result.result_revision, status: result.result_status },
    };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "VERSION_CONFLICT", "RESULT_NOT_FOUND", ...COMMON_CODES]);
  }
}

export async function publishSessionFamilyBriefAction(sessionId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, sessionId);
    const { supabase } = await authorizedClient("review.write");
    const { error } = await supabase.rpc("publish_session_family_brief", { p_session_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "BRIEF_NOT_FOUND", "FORBIDDEN", ...COMMON_CODES]);
  }
}


const preparationReviewSchema = z.object({
  sessionId: uuid,
  artifactKind: z.enum(["solution", "lesson_plan", "rehearsal_video"]),
  decision: z.enum(["approved", "changes_requested"]),
  note: text(1000),
});

export async function reviewSessionPreparationArtifactAction(input: {
  sessionId: string;
  artifactKind: "solution" | "lesson_plan" | "rehearsal_video";
  decision: "approved" | "changes_requested";
  note: string;
}): Promise<ActionResult> {
  try {
    const value = parse(preparationReviewSchema, input);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const { error } = await supabase.rpc("review_session_preparation_artifact", {
      p_session_id: value.sessionId,
      p_artifact_kind: value.artifactKind,
      p_decision: value.decision,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [
      "REVIEW_NOT_FOUND", "REVIEW_ALREADY_DECIDED", "REVIEW_NOTE_REQUIRED", "FORBIDDEN", ...COMMON_CODES,
    ]);
  }
}

const sessionAssignmentPublicationSchema = z.object({
  sessionId: uuid,
  title: requiredText(100),
  content: text(20000),
  dueAt: datetime.nullable(),
});

export async function publishSessionAssignmentAction(input: {
  sessionId: string;
  title: string;
  content: string;
  dueAt: string | null;
}): Promise<ActionResult> {
  try {
    const value = parse(sessionAssignmentPublicationSchema, input);
    const { supabase } = await authorizedClient("review.write");
    const { error } = await supabase.rpc("publish_session_assignment", {
      p_session_id: value.sessionId,
      p_title: value.title,
      p_content: value.content,
      p_due_at: nullableRpcArg(value.dueAt),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "FORBIDDEN", ...COMMON_CODES]);
  }
}

const sessionVideoTaskSchema = z.object({
  sessionId: uuid,
  title: text(100),
  instructions: text(5000),
  dueAt: datetime.nullable(),
});

export async function saveSessionVideoTaskAction(input: {
  sessionId: string;
  title: string;
  instructions: string;
  dueAt: string | null;
}): Promise<ActionResult> {
  try {
    const value = parse(sessionVideoTaskSchema, input);
    const { supabase } = await authorizedClient("review.write");
    const { error } = await supabase.rpc("save_session_video_task", {
      p_session_id: value.sessionId,
      p_title: value.title,
      p_instructions: value.instructions,
      p_due_at: nullableRpcArg(value.dueAt),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "FORBIDDEN", ...COMMON_CODES]);
  }
}

export async function publishSessionVideoTaskAction(sessionId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, sessionId);
    const { supabase } = await authorizedClient("review.write");
    const { error } = await supabase.rpc("publish_session_video_task", { p_session_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "VIDEO_TASK_NOT_FOUND", "FORBIDDEN", ...COMMON_CODES]);
  }
}


const prepArtifactFileSchema = z.object({
  path: requiredText(500),
  name: requiredText(200),
  size: z.number().int().nonnegative().max(12 * 1024 * 1024),
  type: text(200),
});

const sessionPreparationArtifactsSchema = z.object({
  sessionId: uuid,
  solutionNotes: text(5000),
  solutionFiles: z.array(prepArtifactFileSchema).max(10),
  lessonPlanFiles: z.array(prepArtifactFileSchema).max(10),
  rehearsalVideoUrl: z.union([z.literal(""), z.string().url().max(1000).refine((value) => value.startsWith("https://"))]),
});

export async function saveSessionPreparationArtifactsAction(input: {
  sessionId: string;
  solutionNotes: string;
  solutionFiles: Array<{ path: string; name: string; size: number; type: string }>;
  lessonPlanFiles: Array<{ path: string; name: string; size: number; type: string }>;
  rehearsalVideoUrl: string;
}): Promise<ActionResult> {
  try {
    const value = parse(sessionPreparationArtifactsSchema, input);
    const { supabase } = await authorizedClient("courseware.overlay.edit");
    const { error } = await supabase.rpc("save_session_preparation_artifacts", {
      p_session_id: value.sessionId,
      p_solution_notes: value.solutionNotes,
      p_solution_files: value.solutionFiles as unknown as Json,
      p_lesson_plan_files: value.lessonPlanFiles as unknown as Json,
      p_rehearsal_video_url: value.rehearsalVideoUrl,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "FORBIDDEN", ...COMMON_CODES]);
  }
}
