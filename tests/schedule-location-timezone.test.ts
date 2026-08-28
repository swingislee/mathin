import { describe, expect, it } from "vitest";
import { generateSchedulePreview } from "@/features/school/schedule-preview";
import {
  addCalendarDays,
  calendarDayKey,
  dateTimeInputToInstant,
  markConflicts,
  startOfDay,
  startOfWeek,
  type ScheduleEntry,
} from "@/features/school/schedule";
import type { TeachingCalendarEntryV2 } from "@/features/school/teaching-calendar";

function entry(overrides: Partial<ScheduleEntry>): ScheduleEntry {
  return {
    sessionId: crypto.randomUUID(),
    studentId: "",
    classroomId: crypto.randomUUID(),
    classroomName: "Class",
    lectureName: "Lesson",
    scheduledAt: "2026-08-28T10:00:00.000Z",
    durationMin: 90,
    teacherName: "",
    studentName: "",
    roomId: null,
    roomName: null,
    campusId: null,
    campusName: null,
    roomAssignmentOrigin: null,
    ...overrides,
  };
}

function calendarEntry(overrides: Partial<TeachingCalendarEntryV2>): TeachingCalendarEntryV2 {
  return {
    id: crypto.randomUUID(),
    campusId: null,
    campusName: null,
    name: "Calendar rule",
    kind: "closed",
    startsOn: "2026-03-09",
    endsOn: "2026-03-09",
    scheduleMode: null,
    mappedWeekday: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("organization timezone and structured room scheduling", () => {
  it("uses room UUID rather than a room name for overlap conflicts", () => {
    const first = entry({ sessionId: crypto.randomUUID(), roomId: crypto.randomUUID(), roomName: "101" });
    const second = entry({ sessionId: crypto.randomUUID(), roomId: crypto.randomUUID(), roomName: "101" });
    expect(markConflicts([first, second]).every((row) => !row.conflict)).toBe(true);

    const sharedRoomId = crypto.randomUUID();
    const sameRoom = markConflicts([
      { ...first, roomId: sharedRoomId },
      { ...second, roomId: sharedRoomId },
    ]);
    expect(sameRoom.every((row) => row.conflict)).toBe(true);
  });

  it("derives day and week boundaries from an IANA timezone across DST", () => {
    const timeZone = "America/New_York";
    const instant = new Date("2026-03-08T16:00:00.000Z");
    const dayStart = startOfDay(instant, timeZone);
    expect(dayStart.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    const nextDay = addCalendarDays(dayStart, 1, timeZone);
    expect(nextDay.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(nextDay.getTime() - dayStart.getTime()).toBe(23 * 60 * 60_000);
    expect(calendarDayKey(startOfWeek(instant, timeZone), timeZone)).toBe("2026-03-02");
    expect(dateTimeInputToInstant("2026-03-08T02:30", timeZone)).toBeNull();
    expect(dateTimeInputToInstant("2026-03-08T03:30", timeZone)?.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("generates mapped class sessions in organization local time", () => {
    const rows = generateSchedulePreview(
      [{ lectureId: crypto.randomUUID(), no: 1, name: "One" }],
      "2026-03-08",
      [1],
      19,
      0,
      90,
      "America/New_York",
    );
    expect(rows[0].scheduledAt.toISOString()).toBe("2026-03-09T23:00:00.000Z");
  });

  it("lays free-class session drafts across the selected weekdays in sequence", () => {
    const rows = generateSchedulePreview(
      ["One", "Two", "Three", "Four"].map((name, index) => ({
        lectureId: `free-${index + 1}`,
        no: index + 1,
        name,
      })),
      "2026-08-28",
      [5, 6, 0],
      19,
      0,
      90,
      "Asia/Shanghai",
    );

    expect(rows.map((row) => calendarDayKey(row.scheduledAt, "Asia/Shanghai"))).toEqual([
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
      "2026-09-04",
    ]);
  });

  it("skips closures, inserts mapped dates, ignores manual dates, and applies campus precedence", () => {
    const campusA = crypto.randomUUID();
    const rules = [
      calendarEntry({ startsOn: "2026-03-09", endsOn: "2026-03-09" }),
      calendarEntry({
        campusId: campusA,
        campusName: "A",
        kind: "teaching",
        startsOn: "2026-03-09",
        endsOn: "2026-03-09",
        scheduleMode: "mapped",
        mappedWeekday: 1,
      }),
      calendarEntry({
        kind: "makeup",
        startsOn: "2026-03-14",
        endsOn: "2026-03-14",
        scheduleMode: "mapped",
        mappedWeekday: 1,
      }),
      calendarEntry({
        kind: "teaching",
        startsOn: "2026-03-16",
        endsOn: "2026-03-16",
        scheduleMode: "manual",
      }),
    ];
    const lectures = [1, 2, 3].map((no) => ({ lectureId: crypto.randomUUID(), no, name: String(no) }));
    const generate = (campusId: string | null) => generateSchedulePreview(
      lectures, "2026-03-02", [1], 10, 0, 90, "Asia/Shanghai", { entries: rules, campusId },
    ).map((row) => calendarDayKey(row.scheduledAt, "Asia/Shanghai"));

    expect(generate(campusA)).toEqual(["2026-03-02", "2026-03-09", "2026-03-14"]);
    expect(generate(crypto.randomUUID())).toEqual(["2026-03-02", "2026-03-14", "2026-03-23"]);
    expect(generate(null)).toEqual(["2026-03-02", "2026-03-14", "2026-03-23"]);
  });
});
