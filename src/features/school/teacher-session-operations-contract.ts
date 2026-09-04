import { ATTENDANCE_STATUSES, type AttendanceStatus } from "./learning";
import type { ScheduleEntry } from "./schedule";
import { deriveSessionState, type SessionLifecycleColumns } from "./teaching-operations/scopes";
import type { TeachingSessionState } from "./teaching-operations/types";

export interface SessionLifecycleFact extends SessionLifecycleColumns {
  sessionId: string;
}

export type MembershipStatus = "active" | "completed" | "transferred_out" | "withdrawn";

export interface MembershipFact {
  enrollmentId: string;
  classroomId: string;
  studentId: string;
  status: MembershipStatus;
  joinedAt: string;
  leftAt: string | null;
}

export interface SessionAttendanceFact {
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
}

export interface TeacherSessionOperation extends ScheduleEntry {
  state: TeachingSessionState;
  rosterAt: string | null;
  rosterCount: number;
  rosterSource: "session_time" | "current_active";
  attendanceRecordedCount: number;
  attendanceHistoryRecordCount: number;
  attendanceHistoryMismatchCount: number;
  attendanceComplete: boolean;
  attendanceByStatus: Record<AttendanceStatus, number>;
  attendanceHistoryByStatus: Record<AttendanceStatus, number>;
}

export interface BuildTeacherSessionOperationsInput {
  schedule: readonly ScheduleEntry[];
  lifecycles: readonly SessionLifecycleFact[];
  memberships: readonly MembershipFact[];
  attendance: readonly SessionAttendanceFact[];
}

function emptyAttendanceCounts(): Record<AttendanceStatus, number> {
  return { present: 0, absent: 0, late: 0, leave: 0 };
}

function validRosterAt(value: string | null | undefined): string | null {
  return value && Number.isFinite(new Date(value).getTime()) ? value : null;
}

export function resolveSessionMemberships(
  memberships: readonly MembershipFact[],
  rosterAt: string | null,
): { memberships: MembershipFact[]; source: "session_time" | "current_active" } {
  const sessionTime = rosterAt ? new Date(rosterAt).getTime() : Number.NaN;
  if (!Number.isFinite(sessionTime)) {
    return {
      memberships: memberships.filter((membership) => membership.status === "active" && membership.leftAt === null),
      source: "current_active",
    };
  }

  return {
    memberships: memberships.filter((membership) => {
      const joinedAt = new Date(membership.joinedAt).getTime();
      const leftAt = membership.leftAt ? new Date(membership.leftAt).getTime() : Number.POSITIVE_INFINITY;
      return Number.isFinite(joinedAt) && joinedAt <= sessionTime && leftAt > sessionTime;
    }),
    source: "session_time",
  };
}

/**
 * 把课表、当前班级成员与已保存考勤折叠为教师当天的操作行。
 *
 * 同一课次只保留一行；考勤进度只统计课次锚点时刻的班级花名册，避免历史残留或
 * 越界 student_id 让“已点名”数量超过真实名单。
 */
export function buildTeacherSessionOperations({
  schedule,
  lifecycles,
  memberships,
  attendance,
}: BuildTeacherSessionOperationsInput): TeacherSessionOperation[] {
  const lifecycleBySession = new Map(lifecycles.map((row) => [row.sessionId, row]));
  const membershipsByClassroom = new Map<string, MembershipFact[]>();
  for (const membership of memberships) {
    const classroomMemberships = membershipsByClassroom.get(membership.classroomId) ?? [];
    classroomMemberships.push(membership);
    membershipsByClassroom.set(membership.classroomId, classroomMemberships);
  }

  const attendanceBySession = new Map<string, Map<string, AttendanceStatus>>();
  for (const record of attendance) {
    const records = attendanceBySession.get(record.sessionId) ?? new Map<string, AttendanceStatus>();
    records.set(record.studentId, record.status);
    attendanceBySession.set(record.sessionId, records);
  }

  const uniqueSchedule = new Map<string, ScheduleEntry>();
  for (const entry of schedule) {
    if (!uniqueSchedule.has(entry.sessionId)) uniqueSchedule.set(entry.sessionId, entry);
  }

  return Array.from(uniqueSchedule.values())
    .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt) || left.sessionId.localeCompare(right.sessionId))
    .map((entry) => {
      const lifecycle = lifecycleBySession.get(entry.sessionId) ?? {
        sessionId: entry.sessionId,
        startedAt: null,
        endedAt: null,
        deletedAt: null,
        cancelledBy: null,
        voidedAt: null,
      };
      // 开课后 started_at 是不可漂移的名单锚点；尚未开课才使用 scheduled_at。
      // 只有两者都不存在时，才明确回退当前 active 名单。
      const rosterAt = validRosterAt(lifecycle.startedAt) ?? validRosterAt(entry.scheduledAt);
      const resolvedRoster = resolveSessionMemberships(
        membershipsByClassroom.get(entry.classroomId) ?? [],
        rosterAt,
      );
      const roster = new Set(resolvedRoster.memberships.map((membership) => membership.studentId));
      const saved = attendanceBySession.get(entry.sessionId) ?? new Map<string, AttendanceStatus>();
      const attendanceByStatus = emptyAttendanceCounts();
      const attendanceHistoryByStatus = emptyAttendanceCounts();
      let attendanceRecordedCount = 0;
      for (const status of saved.values()) attendanceHistoryByStatus[status] += 1;
      for (const studentId of roster) {
        const status = saved.get(studentId);
        if (!status || !ATTENDANCE_STATUSES.includes(status)) continue;
        attendanceByStatus[status] += 1;
        attendanceRecordedCount += 1;
      }

      return {
        ...entry,
        state: deriveSessionState(lifecycle),
        rosterAt,
        rosterCount: roster.size,
        rosterSource: resolvedRoster.source,
        attendanceRecordedCount,
        attendanceHistoryRecordCount: saved.size,
        attendanceHistoryMismatchCount: Array.from(saved.keys()).filter((studentId) => !roster.has(studentId)).length,
        attendanceComplete: roster.size > 0 && attendanceRecordedCount === roster.size,
        attendanceByStatus,
        attendanceHistoryByStatus,
      };
    });
}
