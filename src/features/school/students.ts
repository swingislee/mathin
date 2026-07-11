import { createClient } from "@/lib/supabase/server";
import { summarizeAttendance, sumStars, type AttendanceStatus, type AttendanceSummary } from "./learning";

export const STUDENT_STATUSES = ["lead", "trialing", "enrolled", "paused", "alumni", "invalid"] as const;
export const FOLLOW_UP_STATUSES = ["pending", "following", "invited", "trialed", "signed", "lost"] as const;

export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export interface StudentSummary {
  id: string;
  name: string;
  grade: number | null;
  status: StudentStatus;
  followUpStatus: FollowUpStatus;
  assignedName: string;
  lastFollowUpAt: string | null;
  nextFollowUpAt: string | null;
  deletedAt: string | null;
}

export interface StudentDetail extends StudentSummary {
  gender: string;
  birthday: string | null;
  phone: string;
  wechat: string;
  school: string;
  region: string;
  source: string;
  parentName: string;
  parentRelation: string;
  parentPhone: string;
  bindCode: string;
  remark: string;
  assignedTo: string | null;
  followUps: StudentFollowUp[];
}

export interface StudentFollowUp {
  id: string;
  content: string;
  kind: string;
  nextFollowUpAt: string | null;
  statusAfter: string | null;
  createdAt: string;
  authorName: string;
}

export interface StudentFilters {
  status?: StudentStatus;
  followUpStatus?: FollowUpStatus;
  grade?: number;
  q?: string;
  recycle: boolean;
  page: number;
}

interface StudentRow {
  id: string;
  name: string;
  gender: string;
  birthday: string | null;
  phone: string;
  wechat: string;
  school: string;
  region: string;
  source: string;
  grade: number | null;
  status: StudentStatus;
  follow_up_status: FollowUpStatus;
  parent_name: string;
  parent_relation: string;
  parent_phone: string;
  bind_code: string;
  remark: string;
  assigned_to: string | null;
  deleted_at: string | null;
  last_follow_up_at: string | null;
  next_follow_up_at: string | null;
  profiles: { display_name: string } | null;
}

interface FollowUpRow {
  id: string;
  content: string;
  kind: string;
  next_follow_up_at: string | null;
  status_after: string | null;
  created_at: string;
  profiles: { display_name: string } | null;
}

const PAGE_SIZE = 20;

export function parseStudentFilters(searchParams: Record<string, string | string[] | undefined>): StudentFilters {
  const pick = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const status = pick("status");
  const followUpStatus = pick("followUpStatus");
  const grade = Number(pick("grade"));
  const page = Math.max(1, Number(pick("page")) || 1);
  return {
    status: STUDENT_STATUSES.includes(status as StudentStatus) ? status as StudentStatus : undefined,
    followUpStatus: FOLLOW_UP_STATUSES.includes(followUpStatus as FollowUpStatus) ? followUpStatus as FollowUpStatus : undefined,
    grade: Number.isInteger(grade) && grade >= 1 && grade <= 12 ? grade : undefined,
    q: pick("q")?.trim().slice(0, 80) || undefined,
    recycle: pick("tab") === "recycle",
    page,
  };
}

function toSummary(row: StudentRow): StudentSummary {
  return {
    id: row.id,
    name: row.name,
    grade: row.grade,
    status: row.status,
    followUpStatus: row.follow_up_status,
    assignedName: row.profiles?.display_name || "",
    lastFollowUpAt: row.last_follow_up_at,
    nextFollowUpAt: row.next_follow_up_at,
    deletedAt: row.deleted_at,
  };
}

export async function listStudents(filters: StudentFilters): Promise<{ students: StudentSummary[]; count: number | null }> {
  const supabase = await createClient();
  const from = (filters.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  let query = supabase
    .from("students")
    .select("id,name,gender,birthday,phone,wechat,school,region,source,grade,status,follow_up_status,parent_name,parent_relation,parent_phone,bind_code,remark,assigned_to,deleted_at,last_follow_up_at,next_follow_up_at,profiles!students_assigned_to_fkey(display_name)", { count: "estimated" });

  query = filters.recycle ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.followUpStatus) query = query.eq("follow_up_status", filters.followUpStatus);
  if (filters.grade) query = query.eq("grade", filters.grade);
  if (filters.q) {
    const escaped = filters.q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    query = query.or(`name.ilike.%${escaped}%,school.ilike.%${escaped}%`);
  }

  const { data, error, count } = await query
    .order("updated_at", { ascending: false })
    .range(from, to)
    .returns<StudentRow[]>();
  if (error) throw new Error(error.message);
  return { students: (data ?? []).map(toSummary), count };
}

export async function getStudentDetail(id: string): Promise<StudentDetail | null> {
  const supabase = await createClient();
  const { data: student, error } = await supabase
    .from("students")
    .select("id,name,gender,birthday,phone,wechat,school,region,source,grade,status,follow_up_status,parent_name,parent_relation,parent_phone,bind_code,remark,assigned_to,deleted_at,last_follow_up_at,next_follow_up_at,profiles!students_assigned_to_fkey(display_name)")
    .eq("id", id)
    .maybeSingle<StudentRow>();
  if (error) throw new Error(error.message);
  if (!student) return null;

  const { data: followUps, error: followUpError } = await supabase
    .from("student_follow_ups")
    .select("id,content,kind,next_follow_up_at,status_after,created_at,profiles!student_follow_ups_author_id_fkey(display_name)")
    .eq("student_id", id)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<FollowUpRow[]>();
  if (followUpError) throw new Error(followUpError.message);

  return {
    ...toSummary(student),
    gender: student.gender,
    birthday: student.birthday,
    phone: student.phone,
    wechat: student.wechat,
    school: student.school,
    region: student.region,
    source: student.source,
    parentName: student.parent_name,
    parentRelation: student.parent_relation,
    parentPhone: student.parent_phone,
    bindCode: student.bind_code,
    remark: student.remark,
    assignedTo: student.assigned_to,
    followUps: (followUps ?? []).map((followUp) => ({
      id: followUp.id,
      content: followUp.content,
      kind: followUp.kind,
      nextFollowUpAt: followUp.next_follow_up_at,
      statusAfter: followUp.status_after,
      createdAt: followUp.created_at,
      authorName: followUp.profiles?.display_name || "",
    })),
  };
}

// ---------------------------------------------------------------------------
// 学习（P4B-5 §8「学习」tab）：报名记录 + 未来课次 + 出勤/星星/作业成绩聚合。
// 数据取用一律靠既有 RLS 收窄（can_access_student / can_view_attendance），
// 无权限时各段自然返回空，不额外在这里重复判权。
// ---------------------------------------------------------------------------

export interface StudentEnrollmentRow {
  classroomId: string;
  classroomName: string;
  courseTitle: string | null;
  status: string;
  joinedAt: string;
  leftAt: string | null;
}

export interface StudentUpcomingSession {
  sessionId: string;
  classroomName: string;
  lectureName: string;
  scheduledAt: string;
}

export interface StudentSubmissionRow {
  assignmentId: string;
  assignmentTitle: string;
  score: number | null;
  feedback: string;
  submittedAt: string | null;
  gradedAt: string | null;
}

export interface StudentLearning {
  hasAccount: boolean;
  enrollments: StudentEnrollmentRow[];
  upcomingSessions: StudentUpcomingSession[];
  attendance: AttendanceSummary;
  starTotal: number;
  submissions: StudentSubmissionRow[];
  reviews: Array<{sessionId:string;lectureName:string;scheduledAt:string;entryScore:number|null;exitScore:number|null;focus:number|null;participation:number|null;mastery:number|null;comment:string}>;
}

interface EnrollmentLearningRow {
  classroom_id: string;
  status: string;
  joined_at: string;
  left_at: string | null;
  classrooms: { name: string; courses: { title: string } | null } | null;
}

interface UpcomingSessionRow {
  id: string;
  title: string;
  scheduled_at: string;
  classrooms: { name: string } | null;
}

interface SubmissionLearningRow {
  assignment_id: string;
  score: number | null;
  feedback: string;
  submitted_at: string | null;
  graded_at: string | null;
  assignments: { title: string } | null;
}

export async function getStudentLearning(studentId: string): Promise<StudentLearning> {
  const supabase = await createClient();

  const { data: studentRow, error: studentError } = await supabase
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .maybeSingle<{ user_id: string | null }>();
  if (studentError) throw new Error(studentError.message);
  const userId = studentRow?.user_id ?? null;

  const [{ data: enrollmentRows, error: enrollmentError }, { data: attendanceRows, error: attendanceError }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("classroom_id,status,joined_at,left_at,classrooms(name,courses(title))")
      .eq("student_id", studentId)
      .order("joined_at", { ascending: false })
      .returns<EnrollmentLearningRow[]>(),
    supabase
      .from("session_attendance")
      .select("status")
      .eq("student_id", studentId)
      .returns<Array<{ status: AttendanceStatus }>>(),
  ]);
  if (enrollmentError) throw new Error(enrollmentError.message);
  if (attendanceError) throw new Error(attendanceError.message);

  const activeClassroomIds = (enrollmentRows ?? [])
    .filter((row) => row.status === "active")
    .map((row) => row.classroom_id);

  let upcomingSessions: StudentUpcomingSession[] = [];
  if (activeClassroomIds.length > 0) {
    const { data: sessionRows, error: sessionError } = await supabase
      .from("class_sessions")
      .select("id,title,scheduled_at,classrooms(name)")
      .in("classroom_id", activeClassroomIds)
      .is("deleted_at", null)
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(10)
      .returns<UpcomingSessionRow[]>();
    if (sessionError) throw new Error(sessionError.message);
    upcomingSessions = (sessionRows ?? []).map((row) => ({
      sessionId: row.id,
      classroomName: row.classrooms?.name || "",
      lectureName: row.title,
      scheduledAt: row.scheduled_at,
    }));
  }

  let starTotal = 0;
  let submissions: StudentSubmissionRow[] = [];
  if (userId) {
    const [{ data: eventRows, error: eventError }, { data: submissionRows, error: submissionError }] = await Promise.all([
      // 星标事件的作者是教师（user_id=教师），学生在 payload.studentId（08-§3.5 单写者语义）
      supabase
        .from("session_events")
        .select("type,at")
        .eq("payload->>studentId", userId)
        .in("type", ["star", "star_undo"])
        .order("at", { ascending: true })
        .returns<Array<{ type: string; at: string }>>(),
      supabase
        .from("submissions")
        .select("assignment_id,score,feedback,submitted_at,graded_at,assignments(title)")
        .eq("user_id", userId)
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .limit(20)
        .returns<SubmissionLearningRow[]>(),
    ]);
    if (eventError) throw new Error(eventError.message);
    if (submissionError) throw new Error(submissionError.message);
    starTotal = sumStars(eventRows ?? []);
    submissions = (submissionRows ?? []).map((row) => ({
      assignmentId: row.assignment_id,
      assignmentTitle: row.assignments?.title || "",
      score: row.score,
      feedback: row.feedback,
      submittedAt: row.submitted_at,
      gradedAt: row.graded_at,
    }));
  }

  const {data:reviewRows,error:reviewError}=await supabase.from("session_reviews").select("session_id,entry_score,exit_score,focus,participation,mastery,comment,class_sessions(title,scheduled_at)").eq("student_id",studentId).order("updated_at",{ascending:false}).limit(5).returns<Array<{session_id:string;entry_score:number|null;exit_score:number|null;focus:number|null;participation:number|null;mastery:number|null;comment:string;class_sessions:{title:string;scheduled_at:string}|null}>>();
  if(reviewError)throw new Error(reviewError.message);

  return {
    hasAccount: Boolean(userId),
    enrollments: (enrollmentRows ?? []).map((row) => ({
      classroomId: row.classroom_id,
      classroomName: row.classrooms?.name || "-",
      courseTitle: row.classrooms?.courses?.title ?? null,
      status: row.status,
      joinedAt: row.joined_at,
      leftAt: row.left_at,
    })),
    upcomingSessions,
    attendance: summarizeAttendance((attendanceRows ?? []).map((row) => row.status)),
    starTotal,
    submissions,
    reviews:(reviewRows??[]).map(r=>({sessionId:r.session_id,lectureName:r.class_sessions?.title??"",scheduledAt:r.class_sessions?.scheduled_at??"",entryScore:r.entry_score,exitScore:r.exit_score,focus:r.focus,participation:r.participation,mastery:r.mastery,comment:r.comment})),
  };
}
