import { describe, expect, it } from "vitest";
import {
  aggregateStaffOverviewEvents,
  aggregateStaffOverviewEventsByPerson,
  buildStaffOverviewWindow,
  normalizeOverviewGrain,
  resolveClassroomCapacityPolicy,
  summarizeTeacherParticipationOutcomes,
  summarizeClassroomCapacity,
} from "@/features/school/home/staff-overview-contract";

describe("staff fact overview contract", () => {
  it("normalizes URL inputs to the supported period set", () => {
    expect(normalizeOverviewGrain("month")).toBe("month");
    expect(normalizeOverviewGrain("quarter")).toBe("week");
  });

  it("compares a partial natural week with the same point in the prior week", () => {
    const timeZone = "Asia/Shanghai";
    const now = new Date("2026-09-03T10:30:00+08:00");
    const window = buildStaffOverviewWindow("week", now, timeZone);
    const comparison = aggregateStaffOverviewEvents([
      { at: "2026-08-31T09:00:00+08:00" },
      { at: "2026-09-03T10:00:00+08:00" },
      { at: "2026-09-03T11:00:00+08:00" },
      { at: "2026-08-24T09:00:00+08:00" },
      { at: "2026-08-27T11:00:00+08:00" },
    ], window, timeZone);

    expect(window.currentStart.toISOString()).toBe("2026-08-30T16:00:00.000Z");
    expect(window.previousCutoff.toISOString()).toBe("2026-08-27T02:30:00.000Z");
    expect(comparison.current).toBe(2);
    expect(comparison.previous).toBe(1);
    expect(comparison.trend).toHaveLength(7);
    expect(comparison.trend[4]?.current).toBeNull();
    expect(comparison.trend[4]?.previous).toBeNull();
  });

  it("draws the full previous month while comparing numbers at the same cutoff", () => {
    const timeZone = "Asia/Shanghai";
    const window = buildStaffOverviewWindow("month", new Date("2026-09-08T10:30:00+08:00"), timeZone);
    const comparison = aggregateStaffOverviewEvents([
      { at: "2026-08-01T09:00:00+08:00" },
      { at: "2026-08-08T11:00:00+08:00" },
      { at: "2026-08-31T23:59:59+08:00" },
      { at: "2026-09-08T10:00:00+08:00" },
      { at: "2026-09-08T11:00:00+08:00" },
      { at: "2026-07-31T23:59:59+08:00" },
    ], window, timeZone);
    expect(comparison).toMatchObject({ current: 1, previous: 1 });
    expect(comparison.trend).toHaveLength(31);
    expect(comparison.trend[7]).toMatchObject({ current: 1, previous: 1 });
    expect(comparison.trend[8]).toMatchObject({ current: null, previous: 0 });
    expect(comparison.trend[30]).toMatchObject({ current: null, previous: 1 });
    expect(comparison.trend.reduce((sum, point) => sum + (point.previous ?? 0), 0)).toBe(3);
  });

  it("deduplicates full-month trends independently from comparable totals", () => {
    const timeZone = "Asia/Shanghai";
    const window = buildStaffOverviewWindow("month", new Date("2026-09-08T10:30:00+08:00"), timeZone);
    const comparison = aggregateStaffOverviewEvents([
      { id: "reconfirmed", at: "2026-08-31T09:00:00+08:00" },
      { id: "reconfirmed", at: "2026-08-01T09:00:00+08:00" },
      { id: "late", at: "2026-08-30T09:00:00+08:00" },
      { id: "late", at: "2026-08-20T09:00:00+08:00" },
      { id: "reconfirmed", at: "2026-09-01T09:00:00+08:00" },
    ], window, timeZone, true);
    expect(comparison).toMatchObject({ current: 1, previous: 1 });
    expect(comparison.trend[0]).toMatchObject({ current: 1, previous: 1 });
    expect(comparison.trend[19]?.previous).toBe(1);
    expect(comparison.trend[29]?.previous).toBe(0);
    expect(comparison.trend[30]?.previous).toBe(0);
  });

  it("counts repeated confirmation transitions once per invitation in each period", () => {
    const timeZone = "Asia/Shanghai";
    const window = buildStaffOverviewWindow("week", new Date("2026-09-03T10:30:00+08:00"), timeZone);
    const comparison = aggregateStaffOverviewEvents([
      { id: "invite-1", at: "2026-09-01T09:00:00+08:00" },
      { id: "invite-1", at: "2026-09-02T09:00:00+08:00" },
      { id: "invite-1", at: "2026-08-25T09:00:00+08:00" },
    ], window, timeZone, true);

    expect(comparison.current).toBe(1);
    expect(comparison.previous).toBe(1);
  });

  it("shows the full last week at the start of a new working week", () => {
    const window = buildStaffOverviewWindow("week", new Date("2026-09-08T09:00:00+08:00"), "Asia/Shanghai", "previous");
    expect(window.isComplete).toBe(true);
    expect(window.currentStart.toISOString()).toBe("2026-08-30T16:00:00.000Z");
    expect(window.currentCutoff.toISOString()).toBe("2026-09-06T16:00:00.000Z");
    expect(window.previousCutoff).toEqual(window.previousEnd);
    const comparison = aggregateStaffOverviewEvents([
      { at: "2026-09-06T23:59:59+08:00" },
      { at: "2026-08-30T23:59:59+08:00" },
      { at: "2026-09-07T00:00:00+08:00" },
    ], window, "Asia/Shanghai");
    expect(comparison).toMatchObject({ current: 1, previous: 1 });
    expect(comparison.trend.every(point => point.current !== null && point.previous !== null)).toBe(true);
  });

  it("compares complete calendar months of different lengths and includes leap days", () => {
    const window = buildStaffOverviewWindow("month", new Date("2026-09-08T09:00:00+08:00"), "Asia/Shanghai", "2024-02-15");
    expect(window.isComplete).toBe(true);
    expect(window.currentDays).toHaveLength(29);
    expect(window.previousDays).toHaveLength(31);
    const comparison = aggregateStaffOverviewEvents([
      { at: "2024-02-29T23:59:59+08:00" },
      { at: "2024-01-31T23:59:59+08:00" },
      { at: "2024-03-01T00:00:00+08:00" },
    ], window, "Asia/Shanghai");
    expect(comparison).toMatchObject({ current: 1, previous: 1 });
    expect(comparison.trend[30]).toMatchObject({ current: null, previous: 1 });
  });

  it("normalizes selected days across years and handles invalid or future dates", () => {
    const now = new Date("2026-09-08T09:00:00+08:00");
    const selected = buildStaffOverviewWindow("week", now, "Asia/Shanghai", "2026-01-02");
    expect(selected.currentStart.toISOString()).toBe("2025-12-28T16:00:00.000Z");
    expect(selected.currentEnd.toISOString()).toBe("2026-01-04T16:00:00.000Z");
    const current = buildStaffOverviewWindow("week", now, "Asia/Shanghai", "current");
    for (const date of ["2026-02-30", "2027-01-01", "invalid", "2026-1-2"])
      expect(buildStaffOverviewWindow("week", now, "Asia/Shanghai", date)).toEqual(current);
    expect(current.isComplete).toBe(false);
  });

  it("keeps current-week comparison at the same local time across daylight saving", () => {
    const window = buildStaffOverviewWindow("week", new Date("2026-03-09T12:00:00-04:00"), "America/New_York", "current");
    expect(window.previousCutoff.toISOString()).toBe("2026-03-02T17:00:00.000Z");
  });

  it("keeps per-person comparisons and an explicit unassigned bucket", () => {
    const timeZone = "Asia/Shanghai";
    const window = buildStaffOverviewWindow("week", new Date("2026-09-03T10:30:00+08:00"), timeZone);
    const comparisons = aggregateStaffOverviewEventsByPerson([
      { id: "invite-1", personId: "staff-a", at: "2026-09-01T09:00:00+08:00" },
      { id: "invite-1", personId: "staff-a", at: "2026-09-02T09:00:00+08:00" },
      { id: "invite-2", personId: null, at: "2026-09-02T09:00:00+08:00" },
      { id: "invite-3", personId: "staff-a", at: "2026-08-25T09:00:00+08:00" },
    ], window, true);

    expect(comparisons).toEqual(expect.arrayContaining([
      { personId: "staff-a", current: 1, previous: 1 },
      { personId: null, current: 1, previous: 0 },
    ]));
  });

  it("counts every participating teacher while deduplicating the institution total", () => {
    const window = buildStaffOverviewWindow("week", new Date("2026-09-03T10:30:00+08:00"), "Asia/Shanghai");
    const outcome = summarizeTeacherParticipationOutcomes([
      {
        id: "participation-1",
        studentId: "student-a",
        at: "2026-09-01T09:00:00+08:00",
        teacherIds: ["teacher-a", "teacher-b"],
      },
      {
        id: "participation-2",
        studentId: "student-a",
        at: "2026-09-02T09:00:00+08:00",
        teacherIds: ["teacher-a"],
      },
      {
        id: "participation-3",
        studentId: "student-b",
        at: "2026-09-02T10:00:00+08:00",
        teacherIds: [],
      },
    ], [
      { id: "enrollment-1", studentId: "student-a", at: "2026-09-03T09:00:00+08:00" },
      { id: "enrollment-2", studentId: "student-b", at: "2026-09-01T09:00:00+08:00" },
    ], window);

    expect(outcome.totalParticipants.current).toBe(2);
    expect(outcome.totalEnrollments.current).toBe(1);
    expect(outcome.unattributedParticipants.current).toBe(1);
    expect(outcome.teachers).toEqual(expect.arrayContaining([
      {
        teacherId: "teacher-a",
        participants: { current: 1, previous: 0 },
        enrollments: { current: 1, previous: 0 },
      },
      {
        teacherId: "teacher-b",
        participants: { current: 1, previous: 0 },
        enrollments: { current: 1, previous: 0 },
      },
    ]));
  });

  it("uses the same elapsed cutoff for prior-period teacher outcomes", () => {
    const window = buildStaffOverviewWindow("week", new Date("2026-09-03T10:30:00+08:00"), "Asia/Shanghai");
    const outcome = summarizeTeacherParticipationOutcomes([
      {
        id: "previous-participation",
        studentId: "student-a",
        at: "2026-08-25T09:00:00+08:00",
        teacherIds: ["teacher-a"],
      },
    ], [
      { id: "before", studentId: "student-a", at: "2026-08-24T09:00:00+08:00" },
      { id: "after-cutoff", studentId: "student-a", at: "2026-08-28T09:00:00+08:00" },
    ], window);

    expect(outcome.totalParticipants.previous).toBe(1);
    expect(outcome.totalEnrollments.previous).toBe(0);
    expect(outcome.teachers[0]?.enrollments.previous).toBe(0);
  });

  it("counts source-confirmed enrollment months independently from participation dates", () => {
    const window = buildStaffOverviewWindow("month", new Date("2026-09-08T04:00:00Z"), "Asia/Shanghai");
    const source = { sourceConfirmed: true, sourceMonth: "2026-09", sourceTeacherIds: ["a"] };
    const outcome = summarizeTeacherParticipationOutcomes([
      { id: "old", studentId: "old", at: "2026-08-01T00:00:00Z", teacherIds: ["a"] },
      { id: "current", studentId: "current", at: "2026-09-02T00:00:00Z", teacherIds: ["a"] },
    ], [
      { ...source, id: "month-only", studentId: "old", at: "" },
      { ...source, id: "no-visit", studentId: "no-visit", at: "2026-09-02T00:00:00Z" },
      { ...source, id: "same-month", studentId: "current", at: "2026-09-02T00:00:00Z" },
      { ...source, id: "duplicate", studentId: "current", at: "2026-09-02T00:00:00Z", sourceTeacherIds: ["a", "b"] },
      { ...source, id: "prior-month", studentId: "prior", at: "", sourceMonth: "2026-08" },
    ], window);
    expect(outcome.totalParticipants.current).toBe(1);
    expect(outcome.totalEnrollments).toEqual({ current: 3, previous: 1 });
    expect(outcome.teachers.find(row => row.teacherId === "a")?.enrollments).toEqual({ current: 3, previous: 1 });
    expect(outcome.teachers.find(row => row.teacherId === "b")).toMatchObject({ participants: { current: 0 }, enrollments: { current: 1 } });
  });

  it("uses the confirmed temporary grade policy and sums gaps per class", () => {
    expect(resolveClassroomCapacityPolicy(1, 99)).toEqual({
      minimumOpen: 6,
      healthy: 12,
      full: 16,
      basis: "temporary_grade_policy",
    });
    expect(resolveClassroomCapacityPolicy(4, null)).toEqual({
      minimumOpen: 6,
      healthy: 15,
      full: 20,
      basis: "temporary_grade_policy",
    });

    expect(summarizeClassroomCapacity([
      { classroomId: "grade-1", grade: 1, classroomCapacity: null, enrolledSeats: 5 },
      { classroomId: "grade-4", grade: 4, classroomCapacity: null, enrolledSeats: 18 },
    ])).toEqual({
      classCount: 2,
      fullSeats: 36,
      enrolledSeats: 23,
      minimumOpenGap: 1,
      healthyDelta: -4,
      remainingSeats: 13,
    });
  });

  it("keeps healthy capacity unknown for grades outside the temporary policy", () => {
    expect(summarizeClassroomCapacity([
      { classroomId: "other", grade: null, classroomCapacity: 10, enrolledSeats: 4 },
    ])).toEqual({
      classCount: 1,
      fullSeats: 10,
      enrolledSeats: 4,
      minimumOpenGap: 2,
      healthyDelta: null,
      remainingSeats: 6,
    });
  });
});
