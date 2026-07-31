import { createClient } from "@/lib/supabase/server";
import { collectPostgrestRowsInBatches } from "@/lib/supabase/postgrest-batches";
import { addDays, startOfDay, startOfWeek } from "./schedule";
import { FOLLOW_UP_STATUSES, type FollowUpStatus, type StudentStatus } from "./students";

// ---------------------------------------------------------------------------
// 学辅跟进工作台数据层（P4C-6 §6）。零权限分支：scope=mine 只是 assigned_to 过滤，
// scope=all 交给 students RLS 自然收窄（无 student.view.all 的人本来就只见名下）。
// 大 UUID 集统一分批，避免 PostgREST 过滤器突破网关请求行限制。
// ---------------------------------------------------------------------------

export const BOARD_SCOPES = ["mine", "all"] as const;
export type BoardScope = (typeof BOARD_SCOPES)[number];

export const BOARD_BUCKETS = ["overdue", "today", "week", "unscheduled", "trialToday", "renewal", "lost"] as const;
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
  isLost: boolean;
  lostDays:number;
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

  const [followUpRows, enrollmentRows] = await Promise.all([
    collectPostgrestRowsInBatches<string, { student_id: string; content: string }>(studentIds, (batch) => supabase
      .from("student_follow_ups")
      .select("student_id,content")
      .in("student_id", batch)
      .order("created_at", { ascending: false })
      .limit(2000)
      .returns<Array<{ student_id: string; content: string }>>()),
    collectPostgrestRowsInBatches<string, { student_id: string; classroom_id: string }>(studentIds, (batch) => supabase
      .from("enrollments")
      .select("student_id,classroom_id")
      .eq("status", "active")
      .in("student_id", batch)
      .returns<Array<{ student_id: string; classroom_id: string }>>()),
  ]);

  const latestByStudent = new Map<string, string>();
  for (const row of followUpRows) {
    if (!latestByStudent.has(row.student_id)) latestByStudent.set(row.student_id, row.content);
  }

  const classroomIds = [...new Set(enrollmentRows.map((row) => row.classroom_id))];
  const [todaySessionRows, futureSessionRows] = classroomIds.length > 0
    ? await Promise.all([
      collectPostgrestRowsInBatches<string, { classroom_id: string }>(classroomIds, (batch) => supabase
        .from("class_sessions")
        .select("classroom_id")
        .in("classroom_id", batch)
        .is("deleted_at", null)
        .gte("scheduled_at", dayStart)
        .lt("scheduled_at", dayEnd)
        .returns<Array<{ classroom_id: string }>>()),
      collectPostgrestRowsInBatches<string, { classroom_id: string }>(classroomIds, (batch) => supabase
        .from("class_sessions")
        .select("classroom_id")
        .in("classroom_id", batch)
        .is("deleted_at", null)
        .gte("scheduled_at", nowIso)
        .returns<Array<{ classroom_id: string }>>()),
    ])
    : [[], []];

  const todayClassrooms = new Set(todaySessionRows.map((row) => row.classroom_id));
  const futureSessionCountByClassroom = new Map<string, number>();
  for (const row of futureSessionRows) {
    futureSessionCountByClassroom.set(
      row.classroom_id,
      (futureSessionCountByClassroom.get(row.classroom_id) ?? 0) + 1,
    );
  }

  const trialTodayIds = new Set<string>();
  const renewalIds = new Set<string>();
  const trialingIds = new Set(students.filter((row) => row.status === "trialing").map((row) => row.id));
  for (const row of enrollmentRows) {
    if (trialingIds.has(row.student_id) && todayClassrooms.has(row.classroom_id)) trialTodayIds.add(row.student_id);
    if ((futureSessionCountByClassroom.get(row.classroom_id) ?? 0) <= 3) renewalIds.add(row.student_id);
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
      case "renewal":return renewalIds.has(row.id);
      case "lost":return row.follow_up_status==="lost"||row.status==="invalid";
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
        isLost:row.follow_up_status==="lost"||row.status==="invalid",
        lostDays:(row.follow_up_status==="lost"||row.status==="invalid")&&row.last_follow_up_at?Math.max(0,Math.floor((now.getTime()-new Date(row.last_follow_up_at).getTime())/86400000)):0,
      })),
  }));

  return { counts, groups };
}
