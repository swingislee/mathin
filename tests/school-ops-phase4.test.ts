import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScheduleEntry } from "@/features/school/schedule";
import { buildTeacherSessionOperations } from "@/features/school/teacher-session-operations-contract";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

function scheduleEntry(overrides: Partial<ScheduleEntry> & Pick<ScheduleEntry, "sessionId" | "classroomId" | "scheduledAt">): ScheduleEntry {
  return {
    studentId: "",
    classroomName: "三年级 A 班",
    lectureName: "分数",
    durationMin: 90,
    teacherName: "张老师",
    studentName: "",
    roomId: null,
    roomName: null,
    campusId: null,
    campusName: null,
    roomAssignmentOrigin: null,
    ...overrides,
  };
}

describe("school ops Phase 4 session and attendance seam", () => {
  it("builds one ordered operation row per session and counts only roster-at-session attendance", () => {
    const first = scheduleEntry({
      sessionId: "session-a",
      classroomId: "class-a",
      scheduledAt: "2026-09-05T01:00:00.000Z",
    });
    const second = scheduleEntry({
      sessionId: "session-b",
      classroomId: "class-b",
      scheduledAt: "2026-09-05T03:00:00.000Z",
    });
    const rows = buildTeacherSessionOperations({
      schedule: [second, first, { ...first }],
      lifecycles: [
        { sessionId: "session-a", startedAt: "2026-09-05T01:00:00.000Z", endedAt: null, deletedAt: null, cancelledBy: null, voidedAt: null },
        { sessionId: "session-b", startedAt: null, endedAt: null, deletedAt: "2026-09-04T00:00:00.000Z", cancelledBy: "staff-a", voidedAt: null },
      ],
      memberships: [
        { enrollmentId: "enrollment-a", classroomId: "class-a", studentId: "student-a", status: "transferred_out", joinedAt: "2026-09-01T00:00:00.000Z", leftAt: "2026-09-05T02:00:00.000Z" },
        { enrollmentId: "enrollment-b", classroomId: "class-a", studentId: "student-b", status: "withdrawn", joinedAt: "2026-09-01T00:00:00.000Z", leftAt: "2026-09-05T01:00:00.001Z" },
        { enrollmentId: "enrollment-new", classroomId: "class-a", studentId: "student-new", status: "active", joinedAt: "2026-09-05T01:00:00.001Z", leftAt: null },
      ],
      attendance: [
        { sessionId: "session-a", studentId: "student-a", status: "present" },
        { sessionId: "session-a", studentId: "student-b", status: "leave" },
        { sessionId: "session-a", studentId: "student-new", status: "absent" },
      ],
    });

    expect(rows.map((row) => row.sessionId)).toEqual(["session-a", "session-b"]);
    expect(rows[0]).toMatchObject({
      state: "started",
      rosterCount: 2,
      attendanceRecordedCount: 2,
      attendanceHistoryRecordCount: 3,
      attendanceHistoryMismatchCount: 1,
      attendanceComplete: true,
      attendanceByStatus: { present: 1, absent: 0, late: 0, leave: 1 },
    });
    expect(rows[1]).toMatchObject({ state: "cancelled", rosterCount: 0, attendanceComplete: false });
  });

  it("loads the organization-day schedule and joins the three authoritative Phase 4 facts", () => {
    const data = read("src", "features", "school", "teacher-session-operations.ts");
    expect(data).toContain("getOrganizationTimezoneV2");
    expect(data).toContain("startOfDay(now, timeZone)");
    expect(data).toContain("getWeekSchedule(from.toISOString(), to.toISOString())");
    for (const table of ["class_sessions", "enrollments", "session_attendance"]) {
      expect(data).toContain(`.from(\"${table}\")`);
    }
    expect(data).toContain("id,classroom_id,student_id,status,joined_at,left_at");
  });

  it("keeps teacher-today roster and attendance actions in the dashboard home", () => {
    const home = read("src", "features", "school", "home", "TodayWorkHome.tsx");
    const view = read("src", "features", "school", "TeacherTodaySessions.tsx");
    const routes = read("src", "features", "school", "dashboard-routes.ts");
    expect(home).toContain("getTodaySessionOperations");
    expect(home).toContain("TeacherTodaySessions");
    expect(home).toContain('returnTo="/dashboard?view=work"');
    expect(home).not.toContain('href="/dashboard/sessions"');
    expect(fs.existsSync(path.join(root, "src", "app", "[locale]", "dashboard", "sessions", "page.tsx"))).toBe(false);
    expect(view).toContain("AttendanceDrawer");
    expect(view).toContain("?tab=students");
    expect(routes).not.toContain('href: "/dashboard/sessions"');
    expect(routes).toContain('hrefPattern: "/dashboard/sessions/[sessionId]"');
  });

  it("keeps attendance persistence on the four-state Mathin fact table", () => {
    const action = read("src", "features", "school", "actions", "attendance.ts");
    expect(action).toContain('authorizedClient("attendance.mark")');
    expect(action).toContain('"get_session_attendance_roster_v2"');
    expect(action).toContain('.from("session_attendance").insert');
    expect(action).toContain('.from("session_attendance").update');
    expect(action).not.toContain('.from("session_attendance").upsert');
    expect(action).toContain("z.enum(ATTENDANCE_STATUSES)");
  });

  it("replaces the permissive insert policy with a roster-at-session guard", () => {
    const migration = read("supabase", "migrations", "20260905000300_school_ops_session_roster_attendance_guard.sql");
    expect(migration).toContain("can_insert_session_attendance_v2");
    expect(migration).toContain("can_view_session_attendance_v2");
    expect(migration).toContain("can_mark_session_attendance_v2");
    expect(migration).toContain("get_session_attendance_roster_v2");
    expect(migration).toContain('drop policy if exists "attendance_select_scope"');
    expect(migration).toContain("public.can_view_attendance(session_id, student_id, (select auth.uid()))");
    expect(migration).toContain("or public.can_view_session_attendance_v2(session_id)");
    expect(migration).toContain('drop policy if exists "attendance_insert_mark"');
    expect(migration).toContain("public.can_mark_session_attendance_v2(session_row.id)");
    expect(migration).toContain("coalesce(session_row.started_at, session_row.scheduled_at)");
    expect(migration).toContain("membership_row.joined_at <=");
    expect(migration).toContain("membership_row.left_at >");
    expect(migration).toContain("membership_row.status = 'active'");
    expect(migration).toContain('drop policy if exists "attendance_update_mark"');
    expect(migration).toContain("revoke update on public.session_attendance from authenticated");
    expect(migration).toContain("grant update (status, note) on public.session_attendance to authenticated");
    expect(migration).toContain("session_row.deleted_at is null");
    expect(migration).toContain("session_row.cancelled_by is null");
    expect(migration).toContain("session_row.voided_at is null");
    expect(migration).toContain("public.is_admin((select auth.uid()))");
    expect(migration).toContain("public.is_staff((select auth.uid()))");
    expect(migration).toContain("public.staff_has_perm((select auth.uid()), 'attendance.mark')");
    expect(migration).toContain("public.staff_has_perm((select auth.uid()), 'class.view.all')");
    expect(migration).toContain("public.is_classroom_teacher(session_row.classroom_id, (select auth.uid()))");
    expect(migration).toContain("session_row.teacher_override = (select auth.uid())");
    expect(migration).toContain("session_row.teacher_override = uid");
    expect(migration).toContain("public.is_staff(uid)");
    expect(migration).toContain("grant execute on function public.get_staff_schedule_v2");
  });

  it("takes back the legacy table-wide attendance UPDATE grant", () => {
    const legacyGrant = read("supabase", "migrations", "20260722000300_p4i15_fix_attendance_update_grant.sql");
    const migration = read("supabase", "migrations", "20260905000300_school_ops_session_roster_attendance_guard.sql");
    expect(legacyGrant).toContain("grant update on public.session_attendance to authenticated");
    expect(migration).toContain("revoke update on public.session_attendance from authenticated");
    expect(migration).toContain("grant update (status, note) on public.session_attendance to authenticated");
  });

  it("ships a rollback-only SQL contract for substitute and roster boundaries", () => {
    const assertions = read("supabase", "tests", "school_ops_phase4_assertions.sql");
    expect(assertions).toContain("begin;");
    expect(assertions).toContain("rollback;");
    expect(assertions).toContain("PHASE4_READONLY_SUBSTITUTE_INSERT_ALLOWED");
    expect(assertions).toContain("PHASE4_ATTENDANCE_PRIMARY_KEY_UPDATE_ALLOWED");
    expect(assertions).toContain("PHASE4_CLOSED_SESSION_MARK_ALLOWED");
    expect(assertions).toContain("PHASE4_INTERNAL_SESSION_CHANGE_BROKEN");
  });

  it("uses [joinedAt, leftAt) for both past and future sessions", () => {
    const past = scheduleEntry({ sessionId: "past", classroomId: "class-a", scheduledAt: "2026-09-05T01:00:00.000Z" });
    const future = scheduleEntry({ sessionId: "future", classroomId: "class-a", scheduledAt: "2026-09-06T01:00:00.000Z" });
    const memberships = [
      { enrollmentId: "joined-on-boundary", classroomId: "class-a", studentId: "student-a", status: "withdrawn" as const, joinedAt: "2026-09-05T01:00:00.000Z", leftAt: "2026-09-05T02:00:00.000Z" },
      { enrollmentId: "left-on-boundary", classroomId: "class-a", studentId: "student-b", status: "withdrawn" as const, joinedAt: "2026-09-01T00:00:00.000Z", leftAt: "2026-09-05T01:00:00.000Z" },
      { enrollmentId: "active-after", classroomId: "class-a", studentId: "student-c", status: "active" as const, joinedAt: "2026-09-05T03:00:00.000Z", leftAt: null },
      { enrollmentId: "future-exit", classroomId: "class-a", studentId: "student-d", status: "active" as const, joinedAt: "2026-09-05T03:00:00.000Z", leftAt: "2026-09-05T23:00:00.000Z" },
    ];
    const rows = buildTeacherSessionOperations({
      schedule: [past, future],
      lifecycles: [],
      memberships,
      attendance: [],
    });

    expect(rows[0]).toMatchObject({ sessionId: "past", rosterCount: 1, rosterSource: "session_time" });
    expect(rows[1]).toMatchObject({ sessionId: "future", rosterCount: 1, rosterSource: "session_time" });
  });

  it("anchors the roster to startedAt after launch and falls back to current active only without a time", () => {
    const rescheduled = scheduleEntry({ sessionId: "started", classroomId: "class-a", scheduledAt: "2026-09-05T05:00:00.000Z" });
    const untimed = scheduleEntry({ sessionId: "untimed", classroomId: "class-b", scheduledAt: "" });
    const memberships = [
      { enrollmentId: "present-at-start", classroomId: "class-a", studentId: "student-a", status: "withdrawn" as const, joinedAt: "2026-09-01T00:00:00.000Z", leftAt: "2026-09-05T02:00:00.000Z" },
      { enrollmentId: "joined-after-start", classroomId: "class-a", studentId: "student-b", status: "active" as const, joinedAt: "2026-09-05T03:00:00.000Z", leftAt: null },
      { enrollmentId: "untimed-active", classroomId: "class-b", studentId: "student-c", status: "active" as const, joinedAt: "2026-09-06T00:00:00.000Z", leftAt: null },
      { enrollmentId: "untimed-ended", classroomId: "class-b", studentId: "student-d", status: "withdrawn" as const, joinedAt: "2026-09-01T00:00:00.000Z", leftAt: "2026-09-02T00:00:00.000Z" },
    ];
    const rows = buildTeacherSessionOperations({
      schedule: [rescheduled, untimed],
      lifecycles: [{ sessionId: "started", startedAt: "2026-09-05T01:00:00.000Z", endedAt: null, deletedAt: null, cancelledBy: null, voidedAt: null }],
      memberships,
      attendance: [],
    });

    expect(rows.find((row) => row.sessionId === "started")).toMatchObject({
      rosterAt: "2026-09-05T01:00:00.000Z",
      rosterCount: 1,
      rosterSource: "session_time",
    });
    expect(rows.find((row) => row.sessionId === "untimed")).toMatchObject({
      rosterAt: null,
      rosterCount: 1,
      rosterSource: "current_active",
    });
  });
});
