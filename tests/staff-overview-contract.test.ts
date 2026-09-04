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
