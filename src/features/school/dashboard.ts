import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FOLLOW_UP_STATUSES, type FollowUpStatus } from "./students";
import { addDays, startOfDay, startOfMonth, startOfWeek } from "./schedule";

// ---------------------------------------------------------------------------
// staff 工作台卡片池数据层（10-§7，P4B-7）。每个函数对应一张卡的查询，
// 页面按 requiredPerm 决定是否调用；调用失败由页面逐卡 try/catch 落空态，
// 这里不重复做权限判断（RLS 兜底 + 页面层已按 hasPerm 决定是否查询）。
// ---------------------------------------------------------------------------

export interface StaffStats {
  enrolledCount: number;
  leadCount: number;
  weekSessionCount: number;
  overdueFollowUpCount: number;
}

export async function getStaffStats(): Promise<StaffStats> {
  const supabase = await createClient();
  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = addDays(weekStart, 7);
  const [enrolled, leads, sessions, overdue] = await Promise.all([
    supabase.from("students").select("*", { count: "exact", head: true }).is("deleted_at", null).eq("status", "enrolled"),
    supabase.from("students").select("*", { count: "exact", head: true }).is("deleted_at", null).in("status", ["lead", "trialing"]),
    supabase
      .from("class_sessions")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("scheduled_at", weekStart.toISOString())
      .lt("scheduled_at", weekEnd.toISOString()),
    supabase.from("students").select("*", { count: "exact", head: true }).is("deleted_at", null).lt("next_follow_up_at", now.toISOString()),
  ]);
  return {
    enrolledCount: enrolled.count ?? 0,
    leadCount: leads.count ?? 0,
    weekSessionCount: sessions.count ?? 0,
    overdueFollowUpCount: overdue.count ?? 0,
  };
}

export interface TodaySessionRow {
  sessionId: string;
  classroomId: string;
  classroomName: string;
  title: string;
  scheduledAt: string;
  teacherName: string;
}

export async function getTodaySchedule(): Promise<TodaySessionRow[]> {
  const supabase = await createClient();
  const now = new Date();
  const from = startOfDay(now);
  const to = addDays(from, 1);
  const { data: sessionRows, error } = await supabase
    .from("class_sessions")
    .select("id,title,scheduled_at,classroom_id,classrooms(name)")
    .is("deleted_at", null)
    .gte("scheduled_at", from.toISOString())
    .lt("scheduled_at", to.toISOString())
    .order("scheduled_at", { ascending: true })
    .returns<Array<{ id: string; title: string; scheduled_at: string; classroom_id: string; classrooms: { name: string } | null }>>();
  if (error) throw new Error(error.message);
  const rows = sessionRows ?? [];
  if (rows.length === 0) return [];

  const classroomIds = Array.from(new Set(rows.map((row) => row.classroom_id)));
  const { data: teacherRows, error: teacherError } = await supabase
    .from("classroom_members")
    .select("classroom_id,profiles(display_name)")
    .in("classroom_id", classroomIds)
    .eq("role", "teacher")
    .returns<Array<{ classroom_id: string; profiles: { display_name: string } | null }>>();
  if (teacherError) throw new Error(teacherError.message);
  const teacherByClassroom = new Map<string, string>();
  for (const row of teacherRows ?? []) {
    if (!teacherByClassroom.has(row.classroom_id) && row.profiles?.display_name) {
      teacherByClassroom.set(row.classroom_id, row.profiles.display_name);
    }
  }

  return rows.map((row) => ({
    sessionId: row.id,
    classroomId: row.classroom_id,
    classroomName: row.classrooms?.name || "-",
    title: row.title,
    scheduledAt: row.scheduled_at,
    teacherName: teacherByClassroom.get(row.classroom_id) || "",
  }));
}

export interface FollowUpFunnelBucket {
  status: FollowUpStatus;
  count: number;
}

export async function getFollowUpFunnel(): Promise<FollowUpFunnelBucket[]> {
  const supabase = await createClient();
  const results = await Promise.all(
    FOLLOW_UP_STATUSES.map((status) => supabase.from("students").select("*", { count: "exact", head: true }).is("deleted_at", null).eq("follow_up_status", status)),
  );
  return FOLLOW_UP_STATUSES.map((status, i) => ({ status, count: results[i].count ?? 0 }));
}

export interface MyOverdueFollowUp {
  studentId: string;
  studentName: string;
  followUpStatus: FollowUpStatus;
  nextFollowUpAt: string;
}

export async function getMyOverdueFollowUps(uid: string): Promise<MyOverdueFollowUp[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .select("id,name,follow_up_status,next_follow_up_at")
    .is("deleted_at", null)
    .eq("assigned_to", uid)
    .lt("next_follow_up_at", new Date().toISOString())
    .order("next_follow_up_at", { ascending: true })
    .limit(8)
    .returns<Array<{ id: string; name: string; follow_up_status: FollowUpStatus; next_follow_up_at: string }>>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    studentId: row.id,
    studentName: row.name,
    followUpStatus: row.follow_up_status,
    nextFollowUpAt: row.next_follow_up_at,
  }));
}

export interface MyPerformance {
  dueTotal: number;
  paidTotal: number;
  enrollCount: number;
}

export async function getMyMonthlyPerformance(uid: string): Promise<MyPerformance> {
  const supabase = await createClient();
  const monthStart = startOfMonth(new Date());
  const { data, error } = await supabase
    .from("orders")
    .select("kind,amount_due,payments(amount)")
    .eq("created_by", uid)
    .gte("created_at", monthStart.toISOString())
    .returns<Array<{ kind: string; amount_due: number; payments: Array<{ amount: number }> }>>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return {
    dueTotal: rows.reduce((sum, row) => sum + row.amount_due, 0),
    paidTotal: rows.reduce((sum, row) => sum + (row.payments ?? []).reduce((s, p) => s + p.amount, 0), 0),
    enrollCount: rows.filter((row) => row.kind === "enroll").length,
  };
}

async function getMyTeacherClassroomIds(supabase: SupabaseClient, uid: string): Promise<string[]> {
  const { data, error } = await supabase.from("classroom_members").select("classroom_id").eq("user_id", uid).eq("role", "teacher");
  if (error) throw new Error(error.message);
  return Array.from(new Set((data ?? []).map((row: { classroom_id: string }) => row.classroom_id)));
}

export interface MyTeachingSession {
  sessionId: string;
  classroomId: string;
  classroomName: string;
  title: string;
  scheduledAt: string;
  isToday: boolean;
  unprepared: boolean;
}

export interface MyTeachingCard {
  sessions: MyTeachingSession[];
  pendingGradingCount: number;
}

export async function getMyTeachingCard(uid: string): Promise<MyTeachingCard> {
  const supabase = await createClient();
  const classroomIds = await getMyTeacherClassroomIds(supabase, uid);
  if (classroomIds.length === 0) return { sessions: [], pendingGradingCount: 0 };

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = addDays(todayStart, 1);
  const weekEnd = addDays(startOfWeek(now), 7);

  const [{ data: sessionRows, error: sessionError }, { data: assignmentRows, error: assignmentError }] = await Promise.all([
    supabase
      .from("class_sessions")
      .select("id,title,scheduled_at,classroom_id,courseware_overlay,classrooms(name)")
      .in("classroom_id", classroomIds)
      .is("deleted_at", null)
      .gte("scheduled_at", todayStart.toISOString())
      .lt("scheduled_at", weekEnd.toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(12)
      .returns<Array<{ id: string; title: string; scheduled_at: string; classroom_id: string; courseware_overlay: unknown[]; classrooms: { name: string } | null }>>(),
    supabase.from("assignments").select("id").in("classroom_id", classroomIds).returns<Array<{ id: string }>>(),
  ]);
  if (sessionError) throw new Error(sessionError.message);
  if (assignmentError) throw new Error(assignmentError.message);

  let pendingGradingCount = 0;
  const assignmentIds = (assignmentRows ?? []).map((row) => row.id);
  if (assignmentIds.length > 0) {
    const { count, error: submissionError } = await supabase
      .from("submissions")
      .select("*", { count: "exact", head: true })
      .in("assignment_id", assignmentIds)
      .is("graded_at", null)
      .not("submitted_at", "is", null);
    if (submissionError) throw new Error(submissionError.message);
    pendingGradingCount = count ?? 0;
  }

  return {
    sessions: (sessionRows ?? []).map((row) => ({
      sessionId: row.id,
      classroomId: row.classroom_id,
      classroomName: row.classrooms?.name || "-",
      title: row.title,
      scheduledAt: row.scheduled_at,
      isToday: row.scheduled_at < todayEnd.toISOString(),
      unprepared: (row.courseware_overlay?.length ?? 0) === 0,
    })),
    pendingGradingCount,
  };
}

export interface MyClassroomCard {
  id: string;
  name: string;
  activeCount: number;
  capacity: number | null;
  doneSessionCount: number;
  totalSessionCount: number;
}

export async function getMyClassroomCards(uid: string): Promise<MyClassroomCard[]> {
  const supabase = await createClient();
  const classroomIds = await getMyTeacherClassroomIds(supabase, uid);
  if (classroomIds.length === 0) return [];
  const { data, error } = await supabase
    .from("classrooms")
    .select("id,name,capacity,archived_at,enrollments!enrollments_classroom_id_fkey(status),class_sessions!class_sessions_classroom_id_fkey(started_at,ended_at)")
    .in("id", classroomIds)
    .is("archived_at", null)
    .is("class_sessions.deleted_at", null)
    .returns<
      Array<{
        id: string;
        name: string;
        capacity: number | null;
        enrollments: Array<{ status: string }>;
        class_sessions: Array<{ started_at: string | null; ended_at: string | null }>;
      }>
    >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name || "-",
    activeCount: (row.enrollments ?? []).filter((e) => e.status === "active").length,
    capacity: row.capacity,
    doneSessionCount: (row.class_sessions ?? []).filter((s) => s.ended_at).length,
    totalSessionCount: (row.class_sessions ?? []).length,
  }));
}

// ---------------------------------------------------------------------------
// P4C-5 §0 反推的新磁贴取数（11-§5.6/§10）。约束：零权限分支（scope 全交 RLS）、
// 禁 N+1、全部用调用者身份的 server client。
// ---------------------------------------------------------------------------

export interface TemplateProgressRow {
  grade: number;
  ready: number;
  total: number;
}

/** 课件模板完成度：按年级分行（教研 templateProgress 贴）。两次轻量行查询内存分组，不拉模板 jsonb。 */
export async function getTemplateProgress(): Promise<TemplateProgressRow[]> {
  const supabase = await createClient();
  const [totalRes, readyRes] = await Promise.all([
    supabase.from("course_lectures").select("courses!inner(grade)").limit(10000).returns<Array<{ courses: { grade: number } }>>(),
    supabase
      .from("course_lectures")
      .select("courses!inner(grade)")
      .neq("courseware_template", "[]")
      .limit(10000)
      .returns<Array<{ courses: { grade: number } }>>(),
  ]);
  if (totalRes.error) throw new Error(totalRes.error.message);
  if (readyRes.error) throw new Error(readyRes.error.message);
  const rows = new Map<number, TemplateProgressRow>();
  for (const row of totalRes.data ?? []) {
    const entry = rows.get(row.courses.grade) ?? { grade: row.courses.grade, ready: 0, total: 0 };
    entry.total += 1;
    rows.set(row.courses.grade, entry);
  }
  for (const row of readyRes.data ?? []) {
    const entry = rows.get(row.courses.grade);
    if (entry) entry.ready += 1;
  }
  return Array.from(rows.values()).sort((a, b) => a.grade - b.grade);
}

export interface TemplateUrgentRow {
  sessionId: string;
  classroomName: string;
  courseId: string;
  courseTitle: string;
  lectureId: string;
  lectureName: string;
  scheduledAt: string;
}

/** 倒排期（§0.3）：未来 7 天开课但 lecture 模板仍为空的课次。只回查空模板讲次，不拉大 jsonb。 */
export async function getTemplateUrgent(): Promise<TemplateUrgentRow[]> {
  const supabase = await createClient();
  const now = new Date();
  const { data: sessionRows, error } = await supabase
    .from("class_sessions")
    .select("id,scheduled_at,lecture_id,classrooms(name)")
    .is("deleted_at", null)
    .is("courseware_frozen_at", null)
    .not("lecture_id", "is", null)
    .gte("scheduled_at", now.toISOString())
    .lt("scheduled_at", addDays(now, 7).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(200)
    .returns<Array<{ id: string; scheduled_at: string; lecture_id: string; classrooms: { name: string } | null }>>();
  if (error) throw new Error(error.message);
  const sessions = sessionRows ?? [];
  if (sessions.length === 0) return [];

  const lectureIds = Array.from(new Set(sessions.map((row) => row.lecture_id)));
  const { data: lectureRows, error: lectureError } = await supabase
    .from("course_lectures")
    .select("id,name,course_id,courses(title)")
    .in("id", lectureIds)
    .eq("courseware_template", "[]")
    .returns<Array<{ id: string; name: string; course_id: string; courses: { title: string } | null }>>();
  if (lectureError) throw new Error(lectureError.message);
  const emptyById = new Map((lectureRows ?? []).map((row) => [row.id, row]));

  return sessions
    .filter((row) => emptyById.has(row.lecture_id))
    .slice(0, 8)
    .map((row) => {
      const lecture = emptyById.get(row.lecture_id)!;
      return {
        sessionId: row.id,
        classroomName: row.classrooms?.name || "-",
        courseId: lecture.course_id,
        courseTitle: lecture.courses?.title || "-",
        lectureId: lecture.id,
        lectureName: lecture.name,
        scheduledAt: row.scheduled_at,
      };
    });
}

export interface GradingQueueRow {
  assignmentId: string;
  classroomId: string;
  studentName: string;
  assignmentTitle: string;
  submittedAt: string;
}

/** 批改清单（§0.4）：我任教班级未批改提交，升序取 8，每行直达批改页。 */
export async function getGradingQueue(uid: string): Promise<GradingQueueRow[]> {
  const supabase = await createClient();
  const classroomIds = await getMyTeacherClassroomIds(supabase, uid);
  if (classroomIds.length === 0) return [];
  const { data: assignmentRows, error: assignmentError } = await supabase
    .from("assignments")
    .select("id,title,classroom_id")
    .in("classroom_id", classroomIds)
    .returns<Array<{ id: string; title: string; classroom_id: string }>>();
  if (assignmentError) throw new Error(assignmentError.message);
  const assignmentById = new Map((assignmentRows ?? []).map((row) => [row.id, row]));
  if (assignmentById.size === 0) return [];

  const { data: submissionRows, error: submissionError } = await supabase
    .from("submissions")
    .select("assignment_id,submitted_at,profiles(display_name)")
    .in("assignment_id", Array.from(assignmentById.keys()))
    .is("graded_at", null)
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: true })
    .limit(8)
    .returns<Array<{ assignment_id: string; submitted_at: string; profiles: { display_name: string } | null }>>();
  if (submissionError) throw new Error(submissionError.message);
  return (submissionRows ?? []).map((row) => {
    const assignment = assignmentById.get(row.assignment_id)!;
    return {
      assignmentId: assignment.id,
      classroomId: assignment.classroom_id,
      studentName: row.profiles?.display_name || "-",
      assignmentTitle: assignment.title || "-",
      submittedAt: row.submitted_at,
    };
  });
}

export interface DueOrderRow {
  orderId: string;
  studentId: string;
  studentName: string;
  dueAmount: number;
  createdAt: string;
}

/** 催缴名单（§0.1/§0.5）：欠额 = amount_due − 已收合计。scope 全靠 orders RLS（§10 零权限分支）。 */
export async function getDueOrders(): Promise<DueOrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id,student_id,amount_due,created_at,students!inner(name),payments(amount)")
    .is("students.deleted_at", null)
    .in("status", ["unpaid", "partial"])
    .order("created_at", { ascending: true })
    .limit(100)
    .returns<
      Array<{
        id: string;
        student_id: string;
        amount_due: number;
        created_at: string;
        students: { name: string } | null;
        payments: Array<{ amount: number }>;
      }>
    >();
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => ({
      orderId: row.id,
      studentId: row.student_id,
      studentName: row.students?.name || "-",
      dueAmount: row.amount_due - (row.payments ?? []).reduce((sum, p) => sum + p.amount, 0),
      createdAt: row.created_at,
    }))
    .filter((row) => row.dueAmount > 0.005)
    .slice(0, 8);
}

export interface UnmarkedSessionRow {
  sessionId: string;
  classroomId: string;
  classroomName: string;
  title: string;
  scheduledAt: string;
}

/** 未点名课次（§0.2）：近 7 天已结束（ended_at 非空或 scheduled_at+duration 已过）且考勤零行。 */
export async function getUnmarkedSessions(): Promise<UnmarkedSessionRow[]> {
  const supabase = await createClient();
  const now = new Date();
  const { data: sessionRows, error } = await supabase
    .from("class_sessions")
    .select("id,title,scheduled_at,duration_min,ended_at,classroom_id,classrooms(name)")
    .is("deleted_at", null)
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", addDays(now, -7).toISOString())
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(200)
    .returns<
      Array<{
        id: string;
        title: string;
        scheduled_at: string;
        duration_min: number | null;
        ended_at: string | null;
        classroom_id: string;
        classrooms: { name: string } | null;
      }>
    >();
  if (error) throw new Error(error.message);
  const ended = (sessionRows ?? []).filter(
    (row) => row.ended_at || new Date(row.scheduled_at).getTime() + (row.duration_min ?? 0) * 60000 < now.getTime(),
  );
  if (ended.length === 0) return [];

  // 一次查回考勤 Set 对账（§10 禁 N+1）。
  const { data: attendanceRows, error: attendanceError } = await supabase
    .from("session_attendance")
    .select("session_id")
    .in("session_id", ended.map((row) => row.id))
    .returns<Array<{ session_id: string }>>();
  if (attendanceError) throw new Error(attendanceError.message);
  const marked = new Set((attendanceRows ?? []).map((row) => row.session_id));

  return ended
    .filter((row) => !marked.has(row.id))
    .slice(0, 8)
    .map((row) => ({
      sessionId: row.id,
      classroomId: row.classroom_id,
      classroomName: row.classrooms?.name || "-",
      title: row.title,
      scheduledAt: row.scheduled_at,
    }));
}

export interface RosterMismatch {
  /** active 报名但学生无账号，或账号不在该教室成员里。 */
  unlinkedEnrollments: number;
  /** 教室 student 成员没有对应 active 报名（只统计带 course_id 的教学班，排除自由教室）。 */
  orphanMembers: number;
}

/** 花名册错位全局对账（§0.2）：两个全量数组内存对账，禁按班级循环 N+1。 */
export async function getRosterMismatchCount(): Promise<RosterMismatch> {
  const supabase = await createClient();
  const [enrollRes, memberRes] = await Promise.all([
    supabase
      .from("enrollments")
      .select("classroom_id,student_id,students!inner(user_id)")
      .is("students.deleted_at", null)
      .eq("status", "active")
      .limit(5000)
      .returns<Array<{ classroom_id: string; student_id: string; students: { user_id: string | null } | null }>>(),
    supabase
      .from("classroom_members")
      .select("classroom_id,user_id,classrooms!inner(course_id)")
      .eq("role", "student")
      .not("classrooms.course_id", "is", null)
      .limit(5000)
      .returns<Array<{ classroom_id: string; user_id: string }>>(),
  ]);
  if (enrollRes.error) throw new Error(enrollRes.error.message);
  if (memberRes.error) throw new Error(memberRes.error.message);
  const enrollments = enrollRes.data ?? [];
  const members = memberRes.data ?? [];

  const memberSet = new Set(members.map((row) => `${row.classroom_id}:${row.user_id}`));
  const enrolledSet = new Set(
    enrollments.filter((row) => row.students?.user_id).map((row) => `${row.classroom_id}:${row.students!.user_id}`),
  );
  return {
    unlinkedEnrollments: enrollments.filter(
      (row) => !row.students?.user_id || !memberSet.has(`${row.classroom_id}:${row.students.user_id}`),
    ).length,
    orphanMembers: members.filter((row) => !enrolledSet.has(`${row.classroom_id}:${row.user_id}`)).length,
  };
}

export interface FollowupBoardCounts {
  overdue: number;
  today: number;
}

/** 跟进台入口贴两数：逾期（next < now）与今日（next 在今天内）。scope 交 students RLS。 */
export async function getFollowupBoardCounts(): Promise<FollowupBoardCounts> {
  const supabase = await createClient();
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = addDays(dayStart, 1);
  const [overdueRes, todayRes] = await Promise.all([
    supabase.from("students").select("*", { count: "exact", head: true }).is("deleted_at", null).lt("next_follow_up_at", now.toISOString()),
    supabase
      .from("students")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("next_follow_up_at", dayStart.toISOString())
      .lt("next_follow_up_at", dayEnd.toISOString()),
  ]);
  return { overdue: overdueRes.count ?? 0, today: todayRes.count ?? 0 };
}

export interface FinanceOverview {
  dueTotal: number;
  paidTotal: number;
  refundTotal: number;
  overdueOrderCount: number;
}

export interface ActivityTodayRow { id:string; title:string; scheduledAt:string; bookedCount:number }
/** P4D-2 今明两天活动；活动表 RLS 限 staff，调用方再按 activity.register 决定是否取数。 */
export async function getActivityToday():Promise<ActivityTodayRow[]> {
  const supabase=await createClient(); const from=startOfDay(new Date()); const to=addDays(from,2);
  const {data,error}=await supabase.from("activities").select("id,title,scheduled_at,activity_registrations(count)").is("deleted_at",null).gte("scheduled_at",from.toISOString()).lt("scheduled_at",to.toISOString()).order("scheduled_at",{ascending:true}).returns<Array<{id:string;title:string;scheduled_at:string;activity_registrations:Array<{count:number}>|null}>>();
  if(error)throw new Error(error.message);return(data??[]).map(x=>({id:x.id,title:x.title,scheduledAt:x.scheduled_at,bookedCount:x.activity_registrations?.[0]?.count??0}));
}
export interface ReviewGapRow{sessionId:string;classroomId:string;classroomName:string;title:string}
export async function getReviewGaps():Promise<ReviewGapRow[]>{const s=await createClient();const now=new Date();const{data:sessions,error}=await s.from("class_sessions").select("id,classroom_id,title,ended_at,scheduled_at,duration_min,classrooms(name)").is("deleted_at",null).gte("scheduled_at",addDays(now,-7).toISOString()).lte("scheduled_at",now.toISOString()).returns<Array<{id:string;classroom_id:string;title:string;ended_at:string|null;scheduled_at:string;duration_min:number|null;classrooms:{name:string}|null}>>();if(error)throw new Error(error.message);const ended=(sessions??[]).filter(x=>x.ended_at||new Date(x.scheduled_at).getTime()+(x.duration_min??0)*60000<Date.now());if(!ended.length)return[];const{data:reviews,error:re}=await s.from("session_reviews").select("session_id").in("session_id",ended.map(x=>x.id)).returns<Array<{session_id:string}>>();if(re)throw new Error(re.message);const marked=new Set((reviews??[]).map(x=>x.session_id));return ended.filter(x=>!marked.has(x.id)).slice(0,8).map(x=>({sessionId:x.id,classroomId:x.classroom_id,classroomName:x.classrooms?.name??"-",title:x.title}))}
export interface VideoQueueRow{id:string;studentName:string;submittedAt:string}
export async function getVideoQueue():Promise<VideoQueueRow[]>{const s=await createClient();const{data,error}=await s.from("session_videos").select("id,submitted_at,students(name)").is("deleted_at",null).is("reviewed_at",null).order("submitted_at",{ascending:true}).limit(8).returns<Array<{id:string;submitted_at:string;students:{name:string}|null}>>();if(error)throw new Error(error.message);return(data??[]).map(x=>({id:x.id,studentName:x.students?.name??"-",submittedAt:x.submitted_at}))}
export async function getRenewalDueCount():Promise<number>{const s=await createClient();const{data:e,error}=await s.from("enrollments").select("student_id,classroom_id").eq("status","active").limit(5000).returns<Array<{student_id:string;classroom_id:string}>>();if(error)throw new Error(error.message);const cids=Array.from(new Set((e??[]).map(x=>x.classroom_id)));if(!cids.length)return 0;const{data:ss,error:se}=await s.from("class_sessions").select("classroom_id").in("classroom_id",cids).is("deleted_at",null).gte("scheduled_at",new Date().toISOString()).returns<Array<{classroom_id:string}>>();if(se)throw new Error(se.message);const counts=new Map<string,number>();for(const x of ss??[])counts.set(x.classroom_id,(counts.get(x.classroom_id)??0)+1);return new Set((e??[]).filter(x=>(counts.get(x.classroom_id)??0)<=3).map(x=>x.student_id)).size}

export async function getFinanceOverview(): Promise<FinanceOverview> {
  const supabase = await createClient();
  const monthStart = startOfMonth(new Date());
  const [dueRes, paidRes, refundRes, overdueRes] = await Promise.all([
    supabase.from("orders").select("amount_due").gte("created_at", monthStart.toISOString()).returns<Array<{ amount_due: number }>>(),
    supabase.from("payments").select("amount").gte("paid_at", monthStart.toISOString()).returns<Array<{ amount: number }>>(),
    supabase
      .from("refunds")
      .select("amount")
      .eq("status", "done")
      .gte("approved_at", monthStart.toISOString())
      .returns<Array<{ amount: number }>>(),
    supabase.from("orders").select("*", { count: "exact", head: true }).in("status", ["unpaid", "partial"]),
  ]);
  if (dueRes.error) throw new Error(dueRes.error.message);
  if (paidRes.error) throw new Error(paidRes.error.message);
  if (refundRes.error) throw new Error(refundRes.error.message);
  if (overdueRes.error) throw new Error(overdueRes.error.message);
  return {
    dueTotal: (dueRes.data ?? []).reduce((sum, row) => sum + row.amount_due, 0),
    paidTotal: (paidRes.data ?? []).reduce((sum, row) => sum + row.amount, 0),
    refundTotal: (refundRes.data ?? []).reduce((sum, row) => sum + row.amount, 0),
    overdueOrderCount: overdueRes.count ?? 0,
  };
}
