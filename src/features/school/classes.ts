import "server-only";

import { getMyPerms } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveClassroomCapabilities, resolveSessionCapabilities } from "./teaching-operations/capabilities";
import { deriveSessionState, resolveSessionCapabilityContext } from "./teaching-operations/scopes";
import type {
  ClassroomCapabilities,
  ClassroomOperationalStatus,
  ClassroomPurpose,
  SessionCapabilities,
  StaffResponsibility,
  TeachingSessionState,
} from "./teaching-operations/types";

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

  const sessions: SessionRow[] = (sessionRows ?? []).map((row) => {
    const state = deriveSessionState({
      startedAt: row.started_at,
      endedAt: row.ended_at,
      deletedAt: row.deleted_at,
      cancelledBy: row.cancelled_by,
      voidedAt: row.voided_at,
    });
    const context = resolveSessionCapabilityContext({
      responsibilities: myResponsibilities,
      isTeacherOverride: row.teacher_override === user.id,
      hasClassManageScope,
      hasClassViewAll,
      hasCourseManage: perms.has("course.manage"),
      hasSessionVoid: perms.has("session.void"),
      hasAttendanceMark: perms.has("attendance.mark"),
      hasReviewWrite: perms.has("review.write"),
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
  });

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
    roster,
    sessions,
  };
}
