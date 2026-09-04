import "server-only";

import { createClient } from "@/lib/supabase/server";
import { collectPostgrestRowsInBatches } from "@/lib/supabase/postgrest-batches";
import { getWeekSchedule } from "./actions/schedule";
import type { AttendanceStatus } from "./learning";
import { getOrganizationTimezoneV2 } from "./organization-locations";
import { addCalendarDays, calendarDayKey, startOfDay } from "./schedule";
import {
  buildTeacherSessionOperations,
  type MembershipFact,
  type MembershipStatus,
  type SessionAttendanceFact,
  type SessionLifecycleFact,
  type TeacherSessionOperation,
} from "./teacher-session-operations-contract";

interface SessionLifecycleRow {
  id: string;
  started_at: string | null;
  ended_at: string | null;
  deleted_at: string | null;
  cancelled_by: string | null;
  voided_at: string | null;
}

interface EnrollmentRow {
  id: string;
  classroom_id: string;
  student_id: string;
  status: MembershipStatus;
  joined_at: string;
  left_at: string | null;
}

interface AttendanceRow {
  session_id: string;
  student_id: string;
  status: AttendanceStatus;
}

interface ScopedAttendanceRow {
  status: AttendanceStatus;
  marked: boolean;
  historyMismatch: boolean;
}

type UntypedRpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return supabase.rpc as UntypedRpc;
}

function parseScopedAttendanceRows(value: unknown): ScopedAttendanceRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: ScopedAttendanceRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    if (!(["present", "absent", "late", "leave"] as unknown[]).includes(row.status)
      || typeof row.marked !== "boolean"
      || typeof row.historyMismatch !== "boolean") return null;
    rows.push({
      status: row.status as AttendanceStatus,
      marked: row.marked,
      historyMismatch: row.historyMismatch,
    });
  }
  return rows;
}

export interface TodaySessionOperationsData {
  dayKey: string;
  fromIso: string;
  toIso: string;
  timeZone: string;
  sessions: TeacherSessionOperation[];
}

/**
 * 教师今日课次的权威读模型。课次范围沿用 get_staff_schedule_v2 的岗位/RLS 口径，
 * 再用 enrollments 的 [joined_at,left_at) 有效期与 session_attendance 计算花名册和点名完成度。
 */
export async function getTodaySessionOperations(now = new Date()): Promise<TodaySessionOperationsData> {
  const timeZone = await getOrganizationTimezoneV2();
  const from = startOfDay(now, timeZone);
  const to = addCalendarDays(from, 1, timeZone);
  const schedule = await getWeekSchedule(from.toISOString(), to.toISOString());

  if (schedule.length === 0) {
    return {
      dayKey: calendarDayKey(from, timeZone),
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      timeZone,
      sessions: [],
    };
  }

  const supabase = await createClient();
  const sessionIds = [...new Set(schedule.map((entry) => entry.sessionId))];
  const classroomIds = [...new Set(schedule.map((entry) => entry.classroomId))];
  const [lifecycleRows, enrollmentRows, attendanceRows, scopedAttendanceResults] = await Promise.all([
    collectPostgrestRowsInBatches<string, SessionLifecycleRow>(sessionIds, (batch) => supabase
      .from("class_sessions")
      .select("id,started_at,ended_at,deleted_at,cancelled_by,voided_at")
      .in("id", batch)
      .returns<SessionLifecycleRow[]>()),
    collectPostgrestRowsInBatches<string, EnrollmentRow>(classroomIds, (batch) => supabase
      .from("enrollments")
      .select("id,classroom_id,student_id,status,joined_at,left_at")
      .in("classroom_id", batch)
      .returns<EnrollmentRow[]>()),
    collectPostgrestRowsInBatches<string, AttendanceRow>(sessionIds, (batch) => supabase
      .from("session_attendance")
      .select("session_id,student_id,status")
      .in("session_id", batch)
      .returns<AttendanceRow[]>()),
    Promise.all(sessionIds.map(async (sessionId) => {
      const { data, error } = await rpc(supabase)("get_session_attendance_roster_v2", {
        p_session_id: sessionId,
      });
      if (error) return null;
      const rows = parseScopedAttendanceRows(data);
      return rows ? ([sessionId, rows] as const) : null;
    })),
  ]);

  const lifecycles: SessionLifecycleFact[] = lifecycleRows.map((row) => ({
    sessionId: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    deletedAt: row.deleted_at,
    cancelledBy: row.cancelled_by,
    voidedAt: row.voided_at,
  }));
  const memberships: MembershipFact[] = enrollmentRows.map((row) => ({
    enrollmentId: row.id,
    classroomId: row.classroom_id,
    studentId: row.student_id,
    status: row.status,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
  }));
  const attendance: SessionAttendanceFact[] = attendanceRows.map((row) => ({
    sessionId: row.session_id,
    studentId: row.student_id,
    status: row.status,
  }));
  const scopedAttendanceBySession = new Map(
    scopedAttendanceResults.filter((result): result is readonly [string, ScopedAttendanceRow[]] => result !== null),
  );
  const sessions = buildTeacherSessionOperations({
    schedule,
    lifecycles,
    memberships,
    attendance,
  }).map((session) => {
    const scopedRows = scopedAttendanceBySession.get(session.sessionId);
    if (!scopedRows) return session;
    const rosterRows = scopedRows.filter((row) => !row.historyMismatch);
    const recordedRosterRows = rosterRows.filter((row) => row.marked);
    const statusCounts: Record<AttendanceStatus, number> = { present: 0, absent: 0, late: 0, leave: 0 };
    for (const row of recordedRosterRows) statusCounts[row.status] += 1;
    return {
      ...session,
      rosterCount: rosterRows.length,
      attendanceRecordedCount: recordedRosterRows.length,
      attendanceHistoryRecordCount: scopedRows.filter((row) => row.marked).length,
      attendanceHistoryMismatchCount: scopedRows.filter((row) => row.marked && row.historyMismatch).length,
      attendanceComplete: rosterRows.length > 0 && recordedRosterRows.length === rosterRows.length,
      attendanceByStatus: statusCounts,
    };
  });

  return {
    dayKey: calendarDayKey(from, timeZone),
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    timeZone,
    sessions,
  };
}
