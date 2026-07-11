import { createClient } from "@/lib/supabase/server";
import { addDays, startOfDay, startOfWeek } from "./schedule";
import { FOLLOW_UP_STATUSES, type FollowUpStatus, type StudentStatus } from "./students";

// ---------------------------------------------------------------------------
// 学辅跟进工作台数据层（P4C-6 §6）。零权限分支：scope=mine 只是 assigned_to 过滤，
// scope=all 交给 students RLS 自然收窄（无 student.view.all 的人本来就只见名下）。
// 取数固定 4 查以内：students 一次 + 最近跟进一次 + 今日试听桶两次辅查，无 N+1。
// ---------------------------------------------------------------------------

export const BOARD_SCOPES = ["mine", "all"] as const;
export type BoardScope = (typeof BOARD_SCOPES)[number];

export const BOARD_BUCKETS = ["overdue", "today", "week", "unscheduled", "trialToday"] as const;
export type BoardBucket = (typeof BOARD_BUCKETS)[number];

export interface BoardRow {
  id: string;
  name: string;
  grade: number | null;
  status: StudentStatus;
  followUpStatus: FollowUpStatus;
  lastFollowUpAt: string | null;
  nextFollowUpAt: string | null;
  overdue: boolean;
  /** 最近一条跟进摘要（单行 truncate 用）。 */
  latestNote: string;
}

export interface BoardGroup {
  status: FollowUpStatus;
  rows: BoardRow[];
}

export interface FollowUpBoard {
  counts: Record<BoardBucket, number>;
  groups: BoardGroup[];
}

export function parseBoardParams(
  searchParams: Record<string, string | string[] | undefined>,
  canScopeAll: boolean,
): { scope: BoardScope; bucket: BoardBucket | undefined } {
  const pick = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const rawScope = pick("scope");
  const rawBucket = pick("bucket");
  return {
    // 默认我名下；无 student.view.all 的人强制 mine（即便手改 URL，RLS 也只回名下）。
    scope: canScopeAll && rawScope === "all" ? "all" : "mine",
    bucket: (BOARD_BUCKETS as readonly string[]).includes(rawBucket ?? "") ? (rawBucket as BoardBucket) : undefined,
  };
}

interface BoardStudentRow {
  id: string;
  name: string;
  grade: number | null;
  status: StudentStatus;
  follow_up_status: FollowUpStatus;
  last_follow_up_at: string | null;
  next_follow_up_at: string | null;
}

export async function listFollowUpBoard(userId: string, scope: BoardScope, bucket?: BoardBucket): Promise<FollowUpBoard> {
  const supabase = await createClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const dayStart = startOfDay(now).toISOString();
  const dayEnd = addDays(startOfDay(now), 1).toISOString();
  const weekStart = startOfWeek(now).toISOString();
  const weekEnd = addDays(startOfWeek(now), 7).toISOString();

  let query = supabase
    .from("students")
    .select("id,name,grade,status,follow_up_status,last_follow_up_at,next_follow_up_at")
    .is("deleted_at", null)
    .order("next_follow_up_at", { ascending: true, nullsFirst: false })
    .limit(500);
  if (scope === "mine") query = query.eq("assigned_to", userId);
  const { data: studentRows, error } = await query.returns<BoardStudentRow[]>();
  if (error) throw new Error(error.message);
  const students = studentRows ?? [];
  const studentIds = students.map((row) => row.id);

  // 每生最近一条跟进：一次 in 查询按时间倒序，内存去重取首条（§6 明令别 N+1）。
  const latestByStudent = new Map<string, string>();
  if (studentIds.length > 0) {
    const { data: followUpRows, error: followUpError } = await supabase
      .from("student_follow_ups")
      .select("student_id,content")
      .in("student_id", studentIds)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (followUpError) throw new Error(followUpError.message);
    for (const row of (followUpRows ?? []) as Array<{ student_id: string; content: string }>) {
      if (!latestByStudent.has(row.student_id)) latestByStudent.set(row.student_id, row.content);
    }
  }

  // 今日试听桶（§0.5）：trialing 且其 active enrollment 班级今天有未删课次——试听当天必跟。
  const trialTodayIds = new Set<string>();
  const trialingIds = students.filter((row) => row.status === "trialing").map((row) => row.id);
  if (trialingIds.length > 0) {
    const { data: enrollmentRows, error: enrollmentError } = await supabase
      .from("enrollments")
      .select("student_id,classroom_id")
      .eq("status", "active")
      .in("student_id", trialingIds)
      .returns<Array<{ student_id: string; classroom_id: string }>>();
    if (enrollmentError) throw new Error(enrollmentError.message);
    const classroomIds = Array.from(new Set((enrollmentRows ?? []).map((row) => row.classroom_id)));
    if (classroomIds.length > 0) {
      const { data: sessionRows, error: sessionError } = await supabase
        .from("class_sessions")
        .select("classroom_id")
        .in("classroom_id", classroomIds)
        .is("deleted_at", null)
        .gte("scheduled_at", dayStart)
        .lt("scheduled_at", dayEnd)
        .returns<Array<{ classroom_id: string }>>();
      if (sessionError) throw new Error(sessionError.message);
      const todayClassrooms = new Set((sessionRows ?? []).map((row) => row.classroom_id));
      for (const row of enrollmentRows ?? []) {
        if (todayClassrooms.has(row.classroom_id)) trialTodayIds.add(row.student_id);
      }
    }
  }

  const inBucket = (row: BoardStudentRow, key: BoardBucket): boolean => {
    const next = row.next_follow_up_at;
    switch (key) {
      case "overdue":
        return next !== null && next < nowIso;
      case "today":
        return next !== null && next >= dayStart && next < dayEnd;
      case "week":
        return next !== null && next >= weekStart && next < weekEnd;
      case "unscheduled":
        return next === null && row.follow_up_status !== "signed" && row.follow_up_status !== "lost";
      case "trialToday":
        return trialTodayIds.has(row.id);
    }
  };

  const counts = Object.fromEntries(
    BOARD_BUCKETS.map((key) => [key, students.filter((row) => inBucket(row, key)).length]),
  ) as Record<BoardBucket, number>;

  const visible = bucket ? students.filter((row) => inBucket(row, bucket)) : students;
  const groups: BoardGroup[] = FOLLOW_UP_STATUSES.map((status) => ({
    status,
    rows: visible
      .filter((row) => row.follow_up_status === status)
      .map((row) => ({
        id: row.id,
        name: row.name,
        grade: row.grade,
        status: row.status,
        followUpStatus: row.follow_up_status,
        lastFollowUpAt: row.last_follow_up_at,
        nextFollowUpAt: row.next_follow_up_at,
        overdue: row.next_follow_up_at !== null && row.next_follow_up_at < nowIso,
        latestNote: latestByStudent.get(row.id) ?? "",
      })),
  }));

  return { counts, groups };
}
