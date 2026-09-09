import { describe, expect, it } from "vitest";
import { classroomRehearsalHref, classroomScheduleBounds, isOutsideClassroomSchedule } from "../src/features/classroom/preparation/schedule-contract";

const schedule = { scheduledAt: "2026-09-09T10:00:00+08:00", durationMin: 45 };
describe("classroom start-time reminder", () => {
  it.each([
    ["2026-09-09T01:59:59Z", true],
    ["2026-09-09T02:00:00Z", false],
    ["2026-09-09T02:44:59Z", false],
    ["2026-09-09T02:45:00Z", true],
    ["2026-09-10T02:00:00Z", true],
  ])("checks the actual click time %s, including timezone and both boundaries", (now, outside) => {
    expect(isOutsideClassroomSchedule([schedule], Date.parse(now))).toBe(outside);
  });
  it("warns when the schedule is missing or invalid", () => {
    expect(isOutsideClassroomSchedule([], Date.now())).toBe(true);
    for (const window of [
      { scheduledAt: null, durationMin: 45 }, { scheduledAt: "bad-date", durationMin: 45 },
      { ...schedule, durationMin: null }, { ...schedule, durationMin: 0 }, { ...schedule, durationMin: -1 },
    ]) {
      expect(classroomScheduleBounds(window)).toBeNull();
      expect(isOutsideClassroomSchedule([window], Date.parse(schedule.scheduledAt))).toBe(true);
    }
  });
  it("accepts any active public-class segment and handles sessions crossing midnight", () => {
    const windows = [schedule, { scheduledAt: "2026-09-09T23:45:00+08:00", durationMin: 30 }];
    expect(isOutsideClassroomSchedule(windows, Date.parse("2026-09-10T00:00:00+08:00"))).toBe(false);
    expect(isOutsideClassroomSchedule(windows, Date.parse("2026-09-09T12:00:00+08:00"))).toBe(true);
  });
  it.each(["session", "activity"] as const)("offers an isolated rehearsal route for %s", (kind) => {
    const href = classroomRehearsalHref("/class/live", "?role=display&entry=live&mode=offline-drill", kind);
    const query = new URL(href, "https://example.test").searchParams;
    expect(query.get("entry")).toBe("prep");
    expect(query.has("role")).toBe(false);
    expect(query.get("mode")).toBe(kind === "activity" ? "host" : "rehearsal");
    if (kind === "activity") expect(query.get("rehearsal")).toBe("1");
  });
});
