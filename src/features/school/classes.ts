import { createClient } from "@/lib/supabase/server";

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
// 班级列表与详情（P4B-3 §9）
// ---------------------------------------------------------------------------

export interface ClassroomSummary {
  id: string;
  name: string;
  courseTitle: string | null;
  grade: number | null;
  capacity: number | null;
  activeCount: number;
  sessionCount: number;
  archivedAt: string | null;
}

export interface ClassroomFilters {
  q?: string;
  page: number;
}

const PAGE_SIZE = 20;

export function parseClassroomFilters(searchParams: Record<string, string | string[] | undefined>): ClassroomFilters {
  const pick = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const page = Math.max(1, Number(pick("page")) || 1);
  return { q: pick("q")?.trim().slice(0, 80) || undefined, page };
}

interface ClassroomListRow {
  id: string;
  name: string;
  grade: number | null;
  capacity: number | null;
  archived_at: string | null;
  courses: { title: string } | null;
  enrollments: Array<{ count: number }> | null;
  class_sessions: Array<{ count: number }> | null;
}

export async function listClassrooms(filters: ClassroomFilters): Promise<{ classrooms: ClassroomSummary[]; count: number | null }> {
  const supabase = await createClient();
  const from = (filters.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  let query = supabase
    .from("classrooms")
    .select(
      "id,name,grade,capacity,archived_at,courses(title),enrollments!enrollments_classroom_id_fkey(count),class_sessions!class_sessions_classroom_id_fkey(count)",
      { count: "estimated" },
    );
  if (filters.q) {
    const escaped = filters.q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    query = query.ilike("name", `%${escaped}%`);
  }
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<ClassroomListRow[]>();
  if (error) throw new Error(error.message);
  return {
    classrooms: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name || "-",
      courseTitle: row.courses?.title ?? null,
      grade: row.grade,
      capacity: row.capacity,
      activeCount: row.enrollments?.[0]?.count ?? 0,
      sessionCount: row.class_sessions?.[0]?.count ?? 0,
      archivedAt: row.archived_at,
    })),
    count,
  };
}

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
  teacherOverrideId: string | null;
  teacherOverrideName: string | null;
  coursewareTrackOverride: "native-16x9" | "adapted-4x3" | null;
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
  roster: RosterRow[];
  sessions: SessionRow[];
}

export interface DeletedSessionRow extends SessionRow {
  deletedAt: string;
}

/** 回收站（P4C-2 §7）：某班已软删的课次，按删除时间倒序。仅 class.manage 页面调用。 */
export async function listDeletedSessions(classroomId: string): Promise<DeletedSessionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_sessions")
        .select("id,lecture_id,lecture_no,title,scheduled_at,duration_min,started_at,ended_at,deleted_at,teacher_override,courseware_track_override,profiles!class_sessions_teacher_override_fkey(display_name)")
    .eq("classroom_id", classroomId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .returns<
      Array<{ id: string; lecture_id: string | null; lecture_no: number | null; title: string; scheduled_at: string | null; duration_min: number | null; started_at: string | null; ended_at: string | null; deleted_at: string; teacher_override: string | null; courseware_track_override: "native-16x9" | "adapted-4x3" | null; profiles: { display_name: string } | null }>
    >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    lectureId: row.lecture_id,
    no: row.lecture_no,
    name: row.title,
    scheduledAt: row.scheduled_at,
    durationMin: row.duration_min,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    deletedAt: row.deleted_at,
    teacherOverrideId: row.teacher_override,
    teacherOverrideName: row.profiles?.display_name ?? null,
    coursewareTrackOverride: row.courseware_track_override,
  }));
}

export async function getClassroomDetail(id: string): Promise<ClassroomDetail | null> {
  const supabase = await createClient();
  const { data: classroom, error } = await supabase
    .from("classrooms")
    .select("id,name,course_id,grade,capacity,room,archived_at,courseware_track,courses(title)")
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
      courses: { title: string } | null;
    }>();
  if (error) throw new Error(error.message);
  if (!classroom) return null;

  const [{ data: enrollmentRows, error: enrollmentError }, { data: memberRows, error: memberError }, { data: sessionRows, error: sessionError }] =
    await Promise.all([
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
        .select("id,lecture_id,lecture_no,title,scheduled_at,duration_min,started_at,ended_at,teacher_override,courseware_track_override,profiles!class_sessions_teacher_override_fkey(display_name)")
        .eq("classroom_id", id)
        .is("deleted_at", null)
        .order("scheduled_at", { ascending: true, nullsFirst: false })
        .returns<Array<{ id: string; lecture_id: string | null; lecture_no: number | null; title: string; scheduled_at: string | null; duration_min: number | null; started_at: string | null; ended_at: string | null; teacher_override: string | null; courseware_track_override: "native-16x9" | "adapted-4x3" | null; profiles: { display_name: string } | null }>>(),
    ]);
  if (enrollmentError) throw new Error(enrollmentError.message);
  if (memberError) throw new Error(memberError.message);
  if (sessionError) throw new Error(sessionError.message);

  const memberUserIds = new Set((memberRows ?? []).filter((m) => m.role === "student").map((m) => m.user_id));
  const roster: RosterRow[] = (enrollmentRows ?? []).map((row) => ({
    enrollmentId: row.id,
    studentId: row.student_id,
    studentName: row.students?.name ?? "-",
    status: row.status,
    hasAccount: Boolean(row.students?.user_id),
    isMember: Boolean(row.students?.user_id && memberUserIds.has(row.students.user_id)),
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
    roster,
    sessions: (sessionRows ?? []).map((row) => ({
      id: row.id,
      lectureId: row.lecture_id,
      no: row.lecture_no,
      name: row.title,
      scheduledAt: row.scheduled_at,
      durationMin: row.duration_min,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      teacherOverrideId: row.teacher_override,
      teacherOverrideName: row.profiles?.display_name ?? null,
      coursewareTrackOverride: row.courseware_track_override,
    })),
  };
}
