import "server-only";

import { getLectureWorkspaceDetail } from "./curriculum/lecture-workspace-detail";
import type { OverlaySlot } from "./courseware-overlay";
import { getMyPerms } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveClassroomCapabilities, resolveSessionCapabilities } from "./teaching-operations/capabilities";
import {
  computeSessionStatusLabel,
  deriveSessionState,
  deriveSessionWorkState,
  resolveSessionCapabilityContext,
  type SessionPrepStatus,
  type SessionStatusLabelKey,
  type SessionWorkState,
} from "./teaching-operations/scopes";
import type {
  ClassroomCapabilities,
  ClassroomOperationalStatus,
  ClassroomPurpose,
  SessionCapabilities,
  StaffResponsibility,
  TeachingSessionState,
} from "./teaching-operations/types";
import type { WorkItemRow } from "./stage/types";
import type { SupportTaskKind } from "./support-tasks";

export interface StaffOption {
  id: string;
  name: string;
}

export async function listStaffOptions(): Promise<StaffOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,display_name")
    .in("role", ["staff", "admin"])
    .eq("is_active", true)
    .order("display_name", { ascending: true })
    .returns<Array<{ id: string; display_name: string }>>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, name: row.display_name || row.id.slice(0, 8) }));
}

// ---------------------------------------------------------------------------
// 班级详情、花名册与课次抽屉（P4H-8 §8.9）
// ---------------------------------------------------------------------------

export interface RosterRow {
  enrollmentId: string | null;
  studentId: string;
  studentName: string;
  status: string | null;
  hasAccount: boolean;
  isMember: boolean;
}

export interface SessionRow {
  id: string;
  lectureId: string | null;
  no: number | null;
  name: string;
  scheduledAt: string | null;
  durationMin: number | null;
  startedAt: string | null;
  endedAt: string | null;
  deletedAt: string | null;
  cancelReason: string;
  voidedAt: string | null;
  voidReason: string;
  teacherOverrideId: string | null;
  teacherOverrideName: string | null;
  coursewareTrackOverride: "native-16x9" | "adapted-4x3" | null;
  state: TeachingSessionState;
  capabilities: SessionCapabilities;
}

/** 学生区域默认列角色（doc19 §13.4）：一人可能同时满足多种，取最高优先级只展示一种，不做多列并陈。 */
export type RosterViewerRole = "registrar" | "teacher" | "support" | "oversight";

export interface ClassroomDetail {
  id: string;
  name: string;
  courseId: string | null;
  courseTitle: string | null;
  grade: number | null;
  capacity: number | null;
  room: string;
  coursewareTrack: "native-16x9" | "adapted-4x3";
  archivedAt: string | null;
  purpose: ClassroomPurpose;
  operationalStatus: ClassroomOperationalStatus;
  trashedAt: string | null;
  primaryTeacherName: string | null;
  learningSupportNames: string[];
  staffAssignments: StaffAssignmentSummary[];
  capabilities: ClassroomCapabilities;
  viewerRole: RosterViewerRole;
  roster: RosterRow[];
  sessions: SessionRow[];
}

export interface StaffAssignmentSummary {
  userId: string;
  name: string;
  responsibility: StaffResponsibility;
}

interface StaffAssignmentRow {
  user_id: string;
  responsibility: StaffResponsibility;
  profiles: { display_name: string } | null;
}

interface SessionQueryRow {
  id: string;
  lecture_id: string | null;
  lecture_no: number | null;
  title: string;
  scheduled_at: string | null;
  duration_min: number | null;
  started_at: string | null;
  ended_at: string | null;
  deleted_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  voided_at: string | null;
  void_reason: string | null;
  teacher_override: string | null;
  courseware_track_override: "native-16x9" | "adapted-4x3" | null;
  profiles: { display_name: string } | null;
}

interface BuildSessionRowInput {
  userId: string;
  myResponsibilities: readonly StaffResponsibility[];
  hasClassManageScope: boolean;
  hasClassViewAll: boolean;
  hasCourseManage: boolean;
  hasSessionVoid: boolean;
  hasAttendanceMark: boolean;
  hasReviewWrite: boolean;
  hasReviewVideo: boolean;
  hasPostworkManage: boolean;
}

/** `SessionQueryRow` + 岗位关系 → `SessionRow`；`getClassroomDetailForScope`（整班）和
 * `getSessionQuickRow`（课表快速抽屉，单课次）共用同一套状态/capabilities 折算逻辑。 */
function buildSessionRow(row: SessionQueryRow, input: BuildSessionRowInput): SessionRow {
  const state = deriveSessionState({
    startedAt: row.started_at,
    endedAt: row.ended_at,
    deletedAt: row.deleted_at,
    cancelledBy: row.cancelled_by,
    voidedAt: row.voided_at,
  });
  const context = resolveSessionCapabilityContext({
    responsibilities: input.myResponsibilities,
    isTeacherOverride: row.teacher_override === input.userId,
    hasClassManageScope: input.hasClassManageScope,
    hasClassViewAll: input.hasClassViewAll,
    hasCourseManage: input.hasCourseManage,
    hasSessionVoid: input.hasSessionVoid,
    hasAttendanceMark: input.hasAttendanceMark,
    hasReviewWrite: input.hasReviewWrite,
    hasReviewVideo: input.hasReviewVideo,
    hasPostworkManage: input.hasPostworkManage,
    state,
  });
  return {
    id: row.id,
    lectureId: row.lecture_id,
    no: row.lecture_no,
    name: row.title,
    scheduledAt: row.scheduled_at,
    durationMin: row.duration_min,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    deletedAt: row.deleted_at,
    cancelReason: row.cancel_reason ?? "",
    voidedAt: row.voided_at,
    voidReason: row.void_reason ?? "",
    teacherOverrideId: row.teacher_override,
    teacherOverrideName: row.profiles?.display_name ?? null,
    coursewareTrackOverride: row.courseware_track_override,
    state,
    capabilities: resolveSessionCapabilities(context),
  };
}

/** 班级详情：把权限、责任关系和课次生命周期一次折叠成 capabilities，UI 不再自行猜角色。 */
export async function getClassroomDetailForScope(id: string): Promise<ClassroomDetail | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: classroom, error } = await supabase
    .from("classrooms")
    .select("id,name,course_id,grade,capacity,room,archived_at,courseware_track,purpose,operational_status,trashed_at,courses(title)")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      name: string;
      course_id: string | null;
      grade: number | null;
      capacity: number | null;
      room: string;
      courseware_track: "native-16x9" | "adapted-4x3";
      archived_at: string | null;
      purpose: ClassroomPurpose;
      operational_status: ClassroomOperationalStatus;
      trashed_at: string | null;
      courses: { title: string } | null;
    }>();
  if (error) throw new Error(error.message);
  if (!classroom) return null;

  const [
    { data: assignmentRows, error: assignmentError },
    { data: enrollmentRows, error: enrollmentError },
    { data: memberRows, error: memberError },
    { data: sessionRows, error: sessionError },
    perms,
  ] = await Promise.all([
    supabase
      .from("classroom_staff_assignments")
      .select("user_id,responsibility,profiles!classroom_staff_assignments_user_id_fkey(display_name)")
      .eq("classroom_id", id)
      .returns<StaffAssignmentRow[]>(),
    supabase
      .from("enrollments")
      .select("id,student_id,status,students(name,user_id)")
      .eq("classroom_id", id)
      .eq("status", "active")
      .returns<Array<{ id: string; student_id: string; status: string; students: { name: string; user_id: string | null } | null }>>(),
    supabase
      .from("classroom_members")
      .select("user_id,role,profiles(display_name)")
      .eq("classroom_id", id)
      .returns<Array<{ user_id: string; role: string; profiles: { display_name: string } | null }>>(),
    supabase
      .from("class_sessions")
      .select("id,lecture_id,lecture_no,title,scheduled_at,duration_min,started_at,ended_at,deleted_at,cancelled_by,cancel_reason,voided_at,void_reason,teacher_override,courseware_track_override,profiles!class_sessions_teacher_override_fkey(display_name)")
      .eq("classroom_id", id)
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .returns<SessionQueryRow[]>(),
    getMyPerms(user.id),
  ]);
  if (assignmentError) throw new Error(assignmentError.message);
  if (enrollmentError) throw new Error(enrollmentError.message);
  if (memberError) throw new Error(memberError.message);
  if (sessionError) throw new Error(sessionError.message);

  const assignments = assignmentRows ?? [];
  const myResponsibilities = assignments.filter((row) => row.user_id === user.id).map((row) => row.responsibility);
  const isTeaching = myResponsibilities.includes("primary_teacher") || myResponsibilities.includes("assistant_teacher");
  const isSupport = myResponsibilities.includes("learning_support");
  const hasClassViewAll = perms.has("class.view.all");
  // can_manage_classroom 的同一公式：class.manage 是写闸，view.all 决定全局 vs 本人任教。
  const hasClassManageScope = perms.has("class.manage") && (hasClassViewAll || isTeaching);
  const isManagement = hasClassManageScope || hasClassViewAll;

  const classroomCapabilities = resolveClassroomCapabilities({
    isTeaching,
    isSupport,
    isManagement,
    classroomTrashed: classroom.trashed_at !== null,
  });

  const viewerRole: RosterViewerRole = hasClassViewAll ? "oversight"
    : isManagement ? "registrar"
    : isTeaching ? "teacher"
    : isSupport ? "support"
    : "registrar";

  const primaryTeacherName = assignments.find((row) => row.responsibility === "primary_teacher")?.profiles?.display_name ?? null;
  const learningSupportNames = assignments
    .filter((row) => row.responsibility === "learning_support")
    .map((row) => row.profiles?.display_name)
    .filter((name): name is string => Boolean(name));
  const staffAssignments: StaffAssignmentSummary[] = assignments.map((row) => ({
    userId: row.user_id,
    name: row.profiles?.display_name || row.user_id.slice(0, 8),
    responsibility: row.responsibility,
  }));

  const memberUserIds = new Set((memberRows ?? []).filter((m) => m.role === "student").map((m) => m.user_id));
  const roster: RosterRow[] = (enrollmentRows ?? []).map((row) => ({
    enrollmentId: row.id,
    studentId: row.student_id,
    studentName: row.students?.name ?? "-",
    status: row.status,
    hasAccount: Boolean(row.students?.user_id),
    isMember: Boolean(row.students?.user_id && memberUserIds.has(row.students.user_id)),
  }));

  const sessions: SessionRow[] = (sessionRows ?? []).map((row) => buildSessionRow(row, {
    userId: user.id,
    myResponsibilities,
    hasClassManageScope,
    hasClassViewAll,
    hasCourseManage: perms.has("course.manage"),
    hasSessionVoid: perms.has("session.void"),
    hasAttendanceMark: perms.has("attendance.mark"),
    hasReviewWrite: perms.has("review.write"),
    hasReviewVideo: perms.has("video.review"),
    hasPostworkManage: perms.has("session.postwork.manage"),
  }));

  return {
    id: classroom.id,
    name: classroom.name || "-",
    courseId: classroom.course_id,
    courseTitle: classroom.courses?.title ?? null,
    grade: classroom.grade,
    capacity: classroom.capacity,
    room: classroom.room,
    coursewareTrack: classroom.courseware_track,
    archivedAt: classroom.archived_at,
    purpose: classroom.purpose,
    operationalStatus: classroom.operational_status,
    trashedAt: classroom.trashed_at,
    primaryTeacherName,
    learningSupportNames,
    staffAssignments,
    capabilities: classroomCapabilities,
    viewerRole,
    roster,
    sessions,
  };
}

export interface SessionQuickRow extends SessionRow {
  classroomId: string;
  classroomName: string;
  classroomRoom: string;
  classroomCoursewareTrack: "native-16x9" | "adapted-4x3";
}

/** 课表快速抽屉用的单课次精简查询（doc19 §15.2），不像 `getClassroomDetailForScope` 那样
 * 拉整班学生/花名册/全部课次。 */
export async function getSessionQuickRow(sessionId: string): Promise<SessionQuickRow | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: row, error } = await supabase
    .from("class_sessions")
    .select(
      "id,lecture_id,lecture_no,title,scheduled_at,duration_min,started_at,ended_at,deleted_at,cancelled_by,cancel_reason,voided_at,void_reason,teacher_override,courseware_track_override,classroom_id," +
        "profiles!class_sessions_teacher_override_fkey(display_name),classrooms(name,room,courseware_track)",
    )
    .eq("id", sessionId)
    .maybeSingle<SessionQueryRow & { classroom_id: string; classrooms: { name: string; room: string; courseware_track: "native-16x9" | "adapted-4x3" } | null }>();
  if (error) throw new Error(error.message);
  if (!row) return null;

  const [{ data: assignmentRows, error: assignmentError }, perms] = await Promise.all([
    supabase
      .from("classroom_staff_assignments")
      .select("responsibility")
      .eq("classroom_id", row.classroom_id)
      .eq("user_id", user.id)
      .returns<Array<{ responsibility: StaffResponsibility }>>(),
    getMyPerms(user.id),
  ]);
  if (assignmentError) throw new Error(assignmentError.message);

  const myResponsibilities = (assignmentRows ?? []).map((assignment) => assignment.responsibility);
  const isTeaching = myResponsibilities.includes("primary_teacher") || myResponsibilities.includes("assistant_teacher");
  const hasClassViewAll = perms.has("class.view.all");
  const hasClassManageScope = perms.has("class.manage") && (hasClassViewAll || isTeaching);

  const sessionRow = buildSessionRow(row, {
    userId: user.id,
    myResponsibilities,
    hasClassManageScope,
    hasClassViewAll,
    hasCourseManage: perms.has("course.manage"),
    hasSessionVoid: perms.has("session.void"),
    hasAttendanceMark: perms.has("attendance.mark"),
    hasReviewWrite: perms.has("review.write"),
    hasReviewVideo: perms.has("video.review"),
    hasPostworkManage: perms.has("session.postwork.manage"),
  });

  return {
    ...sessionRow,
    classroomId: row.classroom_id,
    classroomName: row.classrooms?.name ?? "",
    classroomRoom: row.classrooms?.room ?? "",
    classroomCoursewareTrack: row.classrooms?.courseware_track ?? "native-16x9",
  };
}

// ---------------------------------------------------------------------------
// 课次工作区（P4I-13 §13.3"统一课次点击"落地为 stub；P4I-14 §14 深化课前/课堂/课后）
// ---------------------------------------------------------------------------

export type CoursewareTrack = "native-16x9" | "adapted-4x3";

export interface SessionLeaveRequestRow {
  id: string;
  studentName: string;
  reason: string;
  status: string;
  createdAt: string;
}

export interface SessionCompletionTaskRow {
  id: string;
  kind: "attendance" | "reviews" | "summary" | "assignment" | "video_review" | "followup";
  required: boolean;
  status: "pending" | "done" | "skipped";
  assignedToName: string | null;
  dueAt: string | null;
  completedByName: string | null;
  completedAt: string | null;
  skipReason: string;
}

export interface SessionRosterRow {
  studentId: string;
  studentName: string;
}

export interface SessionSupportTaskRecipientRow {
  id: string;
  studentName: string;
  guardianName: string | null;
  status: "pending" | "sent" | "confirmed" | "failed" | "waived";
  channel: string;
  sentAt: string | null;
  confirmedAt: string | null;
  note: string;
}

export interface SessionSupportTaskRow {
  id: string;
  kind: SupportTaskKind;
  status: "pending" | "done" | "skipped" | "invalidated";
  dueAt: string | null;
  assignedToName: string | null;
  studentName: string | null;
  note: string;
  recipients: SessionSupportTaskRecipientRow[];
}

export interface SessionFamilyBrief {
  lessonTitle: string;
  learningSummary: string;
  homeworkSummary: string;
  materialsNote: string;
  teacherPublicComment: string;
  publishedAt: string | null;
}

export interface SessionWorkspaceDetail {
  id: string;
  classroomId: string;
  classroomName: string;
  lectureId: string | null;
  lectureObjectives: string;
  no: number | null;
  name: string;
  scheduledAt: string | null;
  durationMin: number | null;
  state: TeachingSessionState;
  workState: SessionWorkState;
  statusLabelKey: SessionStatusLabelKey;
  teacherOverrideName: string | null;
  primaryTeacherName: string | null;
  capabilities: SessionCapabilities;
  coursewareTrack: CoursewareTrack;
  coursewareTrackOverride: CoursewareTrack | null;
  coursewareFrozenAt: string | null;
  coursewareOverlay: OverlaySlot[];
  prepStatus: SessionPrepStatus;
  prepAutoFrozen: boolean;
  prepPreparedAt: string | null;
  currentReleaseNo: number | null;
  hasUnpublishedChanges: boolean;
  rosterCount: number;
  roster: SessionRosterRow[];
  pendingLeaveRequests: SessionLeaveRequestRow[];
  completionTasks: SessionCompletionTaskRow[];
  supportTasks: SessionSupportTaskRow[];
  pendingVideoCount: number;
  postworkCompletedAt: string | null;
  familyBrief: SessionFamilyBrief;
}

interface SessionWorkspaceQueryRow {
  id: string;
  classroom_id: string;
  lecture_id: string | null;
  lecture_no: number | null;
  title: string;
  scheduled_at: string | null;
  duration_min: number | null;
  started_at: string | null;
  ended_at: string | null;
  deleted_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  voided_at: string | null;
  void_reason: string | null;
  teacher_override: string | null;
  courseware_track_override: CoursewareTrack | null;
  courseware_frozen_at: string | null;
  courseware_overlay: OverlaySlot[] | null;
  postwork_completed_at: string | null;
  classrooms: { name: string; courseware_track: CoursewareTrack } | null;
  profiles: { display_name: string } | null;
}

/** 单课次版的 `getClassroomDetailForScope`；RLS（sessions_select_*）已把无关用户挡在结果之外。 */
export async function getSessionWorkspaceDetail(sessionId: string): Promise<SessionWorkspaceDetail | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: session, error } = await supabase
    .from("class_sessions")
    .select(
      "id,classroom_id,lecture_id,lecture_no,title,scheduled_at,duration_min,started_at,ended_at,deleted_at," +
        "cancelled_by,cancel_reason,voided_at,void_reason,teacher_override,courseware_track_override," +
        "courseware_frozen_at,courseware_overlay,postwork_completed_at,classrooms(name,courseware_track)," +
        "profiles!class_sessions_teacher_override_fkey(display_name)",
    )
    .eq("id", sessionId)
    .maybeSingle<SessionWorkspaceQueryRow>();
  if (error) throw new Error(error.message);
  if (!session) return null;

  const [
    { data: assignmentRows, error: assignmentError },
    { data: prepRow, error: prepError },
    { data: leaveRows, error: leaveError },
    { data: taskRows, error: taskError },
    { data: briefRow, error: briefError },
    { data: rosterRows, error: rosterError },
    { data: supportTaskRows, error: supportTaskError },
    { count: pendingVideoCount, error: videoError },
    perms,
  ] = await Promise.all([
    supabase
      .from("classroom_staff_assignments")
      .select("user_id,responsibility,profiles!classroom_staff_assignments_user_id_fkey(display_name)")
      .eq("classroom_id", session.classroom_id)
      .returns<Array<{ user_id: string; responsibility: StaffResponsibility; profiles: { display_name: string } | null }>>(),
    supabase
      .from("session_preparations")
      .select("status,auto_frozen,prepared_at")
      .eq("session_id", sessionId)
      .maybeSingle<{ status: SessionPrepStatus; auto_frozen: boolean; prepared_at: string | null }>(),
    supabase
      .from("session_leave_requests")
      .select("id,reason,status,created_at,students(name)")
      .eq("session_id", sessionId)
      .eq("status", "pending")
      .returns<Array<{ id: string; reason: string; status: string; created_at: string; students: { name: string } | null }>>(),
    supabase
      .from("session_completion_tasks")
      .select(
        "id,kind,required,status,due_at,completed_at,skip_reason," +
          "assigned:profiles!session_completion_tasks_assigned_to_fkey(display_name)," +
          "completer:profiles!session_completion_tasks_completed_by_fkey(display_name)",
      )
      .eq("session_id", sessionId)
      .returns<Array<{
        id: string;
        kind: SessionCompletionTaskRow["kind"];
        required: boolean;
        status: SessionCompletionTaskRow["status"];
        due_at: string | null;
        completed_at: string | null;
        skip_reason: string | null;
        assigned: { display_name: string } | null;
        completer: { display_name: string } | null;
      }>>(),
    supabase
      .from("session_family_briefs")
      .select("lesson_title,learning_summary,homework_summary,materials_note,teacher_public_comment,published_at")
      .eq("session_id", sessionId)
      .maybeSingle<{
        lesson_title: string;
        learning_summary: string;
        homework_summary: string;
        materials_note: string;
        teacher_public_comment: string;
        published_at: string | null;
      }>(),
    supabase
      .from("enrollments")
      .select("student_id,students(name)")
      .eq("classroom_id", session.classroom_id)
      .eq("status", "active")
      .returns<Array<{ student_id: string; students: { name: string } | null }>>(),
    supabase
      .from("class_support_tasks")
      .select(
        "id,kind,status,due_at,note," +
          "assigned:profiles!class_support_tasks_assigned_to_fkey(display_name)," +
          "student:students(name)," +
          "class_support_task_recipients(id,status,channel,sent_at,confirmed_at,note,students(name)," +
          "guardian:profiles!class_support_task_recipients_guardian_id_fkey(display_name))",
      )
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .returns<Array<{
        id: string;
        kind: SupportTaskKind;
        status: SessionSupportTaskRow["status"];
        due_at: string | null;
        note: string;
        assigned: { display_name: string } | null;
        student: { name: string } | null;
        class_support_task_recipients: Array<{
          id: string;
          status: SessionSupportTaskRecipientRow["status"];
          channel: string;
          sent_at: string | null;
          confirmed_at: string | null;
          note: string;
          students: { name: string } | null;
          guardian: { display_name: string } | null;
        }>;
      }>>(),
    supabase
      .from("session_videos")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .is("deleted_at", null)
      .is("reviewed_at", null),
    getMyPerms(user.id),
  ]);
  if (assignmentError) throw new Error(assignmentError.message);
  if (prepError) throw new Error(prepError.message);
  if (leaveError) throw new Error(leaveError.message);
  if (taskError) throw new Error(taskError.message);
  if (briefError) throw new Error(briefError.message);
  if (rosterError) throw new Error(rosterError.message);
  if (supportTaskError) throw new Error(supportTaskError.message);
  if (videoError) throw new Error(videoError.message);

  const myResponsibilities = (assignmentRows ?? []).filter((row) => row.user_id === user.id).map((row) => row.responsibility);
  const isTeaching = myResponsibilities.includes("primary_teacher") || myResponsibilities.includes("assistant_teacher");
  const hasClassViewAll = perms.has("class.view.all");
  const hasClassManageScope = perms.has("class.manage") && (hasClassViewAll || isTeaching);

  const state = deriveSessionState({
    startedAt: session.started_at,
    endedAt: session.ended_at,
    deletedAt: session.deleted_at,
    cancelledBy: session.cancelled_by,
    voidedAt: session.voided_at,
  });
  const context = resolveSessionCapabilityContext({
    responsibilities: myResponsibilities,
    isTeacherOverride: session.teacher_override === user.id,
    hasClassManageScope,
    hasClassViewAll,
    hasCourseManage: perms.has("course.manage"),
    hasSessionVoid: perms.has("session.void"),
    hasAttendanceMark: perms.has("attendance.mark"),
    hasReviewWrite: perms.has("review.write"),
    hasReviewVideo: perms.has("video.review"),
    hasPostworkManage: perms.has("session.postwork.manage"),
    state,
  });

  const resolvedTrack: CoursewareTrack = session.courseware_track_override ?? session.classrooms?.courseware_track ?? "native-16x9";
  const workState = deriveSessionWorkState(prepRow?.status ?? null, session.postwork_completed_at, state);
  const statusLabelKey = computeSessionStatusLabel(state, workState, session.scheduled_at);
  const primaryTeacherName = (assignmentRows ?? []).find((row) => row.responsibility === "primary_teacher")?.profiles?.display_name ?? null;

  let currentReleaseNo: number | null = null;
  let hasUnpublishedChanges = false;
  let lectureObjectives = "";
  if (session.lecture_id) {
    const lecture = await getLectureWorkspaceDetail(session.lecture_id).catch(() => null);
    const trackState = lecture?.tracks.find((track) => track.track === resolvedTrack);
    currentReleaseNo = trackState?.currentReleaseNo ?? null;
    hasUnpublishedChanges = trackState?.hasUnpublishedChanges ?? false;
    lectureObjectives = lecture?.lecture.objectives ?? "";
  }

  return {
    id: session.id,
    classroomId: session.classroom_id,
    classroomName: session.classrooms?.name || "-",
    lectureId: session.lecture_id,
    lectureObjectives,
    no: session.lecture_no,
    name: session.title,
    scheduledAt: session.scheduled_at,
    durationMin: session.duration_min,
    state,
    workState,
    statusLabelKey,
    teacherOverrideName: session.profiles?.display_name ?? null,
    primaryTeacherName,
    capabilities: resolveSessionCapabilities(context),
    coursewareTrack: resolvedTrack,
    coursewareTrackOverride: session.courseware_track_override,
    coursewareFrozenAt: session.courseware_frozen_at,
    coursewareOverlay: session.courseware_overlay ?? [],
    prepStatus: prepRow?.status ?? "not_started",
    prepAutoFrozen: prepRow?.auto_frozen ?? false,
    prepPreparedAt: prepRow?.prepared_at ?? null,
    currentReleaseNo,
    hasUnpublishedChanges,
    rosterCount: (rosterRows ?? []).length,
    roster: (rosterRows ?? []).map((row) => ({
      studentId: row.student_id,
      studentName: row.students?.name ?? "-",
    })),
    pendingLeaveRequests: (leaveRows ?? []).map((row) => ({
      id: row.id,
      studentName: row.students?.name ?? "-",
      reason: row.reason,
      status: row.status,
      createdAt: row.created_at,
    })),
    completionTasks: (taskRows ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      required: row.required,
      status: row.status,
      assignedToName: row.assigned?.display_name ?? null,
      dueAt: row.due_at,
      completedByName: row.completer?.display_name ?? null,
      completedAt: row.completed_at,
      skipReason: row.skip_reason ?? "",
    })),
    supportTasks: (supportTaskRows ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      dueAt: row.due_at,
      assignedToName: row.assigned?.display_name ?? null,
      studentName: row.student?.name ?? null,
      note: row.note,
      recipients: row.class_support_task_recipients.map((recipient) => ({
        id: recipient.id,
        studentName: recipient.students?.name ?? "-",
        guardianName: recipient.guardian?.display_name ?? null,
        status: recipient.status,
        channel: recipient.channel,
        sentAt: recipient.sent_at,
        confirmedAt: recipient.confirmed_at,
        note: recipient.note,
      })),
    })),
    pendingVideoCount: pendingVideoCount ?? 0,
    postworkCompletedAt: session.postwork_completed_at,
    familyBrief: {
      lessonTitle: briefRow?.lesson_title ?? "",
      learningSummary: briefRow?.learning_summary ?? "",
      homeworkSummary: briefRow?.homework_summary ?? "",
      materialsNote: briefRow?.materials_note ?? "",
      teacherPublicComment: briefRow?.teacher_public_comment ?? "",
      publishedAt: briefRow?.published_at ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// 课次五分组、角色列信号、教学准备、运营记录（P4I-13 §13）
// ---------------------------------------------------------------------------

export interface SessionGroups {
  next: SessionRow | null;
  needsAttention: SessionRow[];
  upcoming: SessionRow[];
  ended: SessionRow[];
  cancelled: SessionRow[];
}

/** 未开始/进行中的课次按时间升序；没有排课时间的排到最后。 */
function sortLiveSessions(sessions: readonly SessionRow[]): SessionRow[] {
  return sessions
    .filter((row) => row.state === "scheduled" || row.state === "started")
    .slice()
    .sort((a, b) => {
      if (!a.scheduledAt) return 1;
      if (!b.scheduledAt) return -1;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });
}

/** 固定五分组（doc19 §13.3）：下一课单条置顶；"需要处理"来自统一工作项投影而不是另起判断逻辑。 */
export function groupClassroomSessions(sessions: readonly SessionRow[], workItems: readonly WorkItemRow[]): SessionGroups {
  const attentionSessionIds = new Set(
    workItems
      .filter((item) => item.primaryObjectType === "session" && item.urgencyBucket !== "backlog")
      .map((item) => item.primaryObjectId),
  );
  const cancelled = sessions.filter((row) => row.state === "cancelled" || row.state === "voided");
  const ended = sessions.filter((row) => row.state === "ended");
  const live = sortLiveSessions(sessions);
  const next = live[0] ?? null;
  const rest = live.slice(1);
  const needsAttention = rest.filter((row) => attentionSessionIds.has(row.id));
  const upcoming = rest.filter((row) => !attentionSessionIds.has(row.id));
  return { next, needsAttention, upcoming, ended, cancelled };
}

export interface RosterSignals {
  recentAbsences: number;
  pendingSubmissions: number;
  gradedAvg: number | null;
  pendingLeaveRequests: number;
  accountBalance: number;
}

interface RosterSignalsRow {
  student_id: string;
  recent_absences: number;
  pending_submissions: number;
  graded_avg: number | null;
  pending_leave_requests: number;
  account_balance: number;
}

/** 出勤/作业/请假/欠费信号（`get_classroom_roster_signals`，P4I-13）；assignments/submissions/student_accounts
 * 各自的 RLS 走的是与 classroom_staff_assignments 不同的模型（旧 classroom_members / finance 权限），
 * 直查会被挡，统一走这个 SECURITY DEFINER RPC。 */
export async function getClassroomRosterSignals(classroomId: string): Promise<Map<string, RosterSignals>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_classroom_roster_signals", { p_classroom_id: classroomId }).returns<RosterSignalsRow[]>();
  if (error) throw new Error(error.message);
  const map = new Map<string, RosterSignals>();
  for (const row of data ?? []) {
    map.set(row.student_id, {
      recentAbsences: row.recent_absences,
      pendingSubmissions: row.pending_submissions,
      gradedAvg: row.graded_avg,
      pendingLeaveRequests: row.pending_leave_requests,
      accountBalance: row.account_balance,
    });
  }
  return map;
}

export interface TeachingReadinessRow {
  sessionId: string;
  lectureNo: number | null;
  lectureName: string;
  prepStatus: "not_started" | "in_progress" | "ready" | null;
  workflowStage: string | null;
  hasUnpublishedChanges: boolean;
  currentReleaseNo: number | null;
  teacherOverrideName: string | null;
  coursewareTrackOverride: "native-16x9" | "adapted-4x3" | null;
}

/** 接下来几节课的备课状态 + 课件风险（`session_preparations` + `getLectureWorkspaceDetail`，均为首次 TS 消费）。 */
export async function getClassroomTeachingReadiness(
  defaultTrack: "native-16x9" | "adapted-4x3",
  sessions: readonly SessionRow[],
): Promise<TeachingReadinessRow[]> {
  const targets = sortLiveSessions(sessions).filter((row) => row.lectureId).slice(0, 3);
  if (targets.length === 0) return [];

  const supabase = await createClient();
  const { data: prepRows, error: prepError } = await supabase
    .from("session_preparations")
    .select("session_id,status")
    .in("session_id", targets.map((row) => row.id))
    .returns<Array<{ session_id: string; status: "not_started" | "in_progress" | "ready" }>>();
  if (prepError) throw new Error(prepError.message);
  const prepBySession = new Map((prepRows ?? []).map((row) => [row.session_id, row.status]));

  const details = await Promise.all(targets.map((row) => getLectureWorkspaceDetail(row.lectureId!).catch(() => null)));

  return targets.map((row, index) => {
    const detail = details[index];
    const effectiveTrack = row.coursewareTrackOverride ?? defaultTrack;
    const trackState = detail?.tracks.find((track) => track.track === effectiveTrack) ?? null;
    return {
      sessionId: row.id,
      lectureNo: row.no,
      lectureName: row.name,
      prepStatus: prepBySession.get(row.id) ?? null,
      workflowStage: trackState?.stage ?? null,
      hasUnpublishedChanges: trackState?.hasUnpublishedChanges ?? false,
      currentReleaseNo: trackState?.currentReleaseNo ?? null,
      teacherOverrideName: row.teacherOverrideName,
      coursewareTrackOverride: row.coursewareTrackOverride,
    };
  });
}

export interface OperationalEventRow {
  eventType: string;
  occurredAt: string;
  actorName: string;
}

/** 运营记录时间线（`list_classroom_operational_events`，P4I-13）。 */
export async function getClassroomOperationalEvents(classroomId: string): Promise<OperationalEventRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("list_classroom_operational_events", { p_classroom_id: classroomId })
    .returns<Array<{ event_type: string; occurred_at: string; actor_name: string }>>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ eventType: row.event_type, occurredAt: row.occurred_at, actorName: row.actor_name }));
}
