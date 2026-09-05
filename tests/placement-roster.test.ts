import { describe, expect, it } from "vitest";
import type { PlacementClassroom, PlacementStudent } from "../src/features/school/enrollment-workflow-contract";
import { placementRosterSeats, placementSeatTargetError } from "../src/features/school/placement-roster";

const classroom: PlacementClassroom = {
  id: "class-a", name: "Class A", courseId: "course", termId: "term", capacity: 4,
  activeCount: 0, operationalStatus: "active", teacherNames: "Teacher", sessions: [],
};
const member = (key: string, seat: number | null, overrides: Partial<PlacementStudent> = {}): PlacementStudent => ({
  key, enrollmentId: `enrollment-${key}`, membershipId: `membership-${key}`, studentId: key,
  name: key, phone: "", grade: 4, courseId: "course", courseTitle: "Math", termId: "term",
  classroomId: classroom.id, note: "", recommendation: "", seat, status: "active", ...overrides,
});
const target = (seat: number | null) => ({ termId: "term", grade: 4, seat });

describe("placement roster display", () => {
  it("keeps explicit positions and fills missing or duplicate positions without changing source facts", () => {
    const rows = [member("missing", null), member("second", 2), member("duplicate", 2), member("fourth", 4)];
    const before = structuredClone(rows);
    expect(placementRosterSeats(classroom, rows).map((slot) => [slot.seat, slot.student?.key ?? null]))
      .toEqual([[1, "missing"], [2, "second"], [3, "duplicate"], [4, "fourth"]]);
    expect(rows).toEqual(before);
  });
  it("retains paused and over-capacity members while excluding withdrawals and other classrooms", () => {
    const rows = [member("paused", 1, { status: "paused" }), member("overflow", 6), member("withdrawn", 2, { status: "withdrawn" }), member("elsewhere", 3, { classroomId: "class-b" })];
    const seats = placementRosterSeats(classroom, rows);
    expect(seats).toHaveLength(6);
    expect(seats.filter((slot) => slot.student).map((slot) => slot.student?.key)).toEqual(["paused", "overflow"]);
    expect(seats[1].student).toBeNull();
  });
  it("provides one trailing empty seat for unbounded classes and preserves zero-capacity display", () => {
    expect(placementRosterSeats({ ...classroom, capacity: null }, [])).toEqual([{ seat: 1, student: null }]);
    const seats = placementRosterSeats({ ...classroom, capacity: null }, [member("last", 5)]);
    expect(seats.at(-1)).toEqual({ seat: 6, student: null });
    expect(placementRosterSeats({ ...classroom, capacity: 0 }, [])).toEqual([]);
    expect(placementRosterSeats({ ...classroom, capacity: 0 }, [member("retained", null)])[0].student?.key).toBe("retained");
  });
});

describe("placement seat destinations", () => {
  it("allows a same-class swap even when all places are occupied", () => {
    const rows = [member("first", 1), member("second", 2)];
    expect(placementSeatTargetError(rows[0], { ...classroom, capacity: 2, activeCount: 2 }, target(2), rows)).toBeNull();
  });
  it("rejects occupied cross-class seats and permits empty ones", () => {
    const source = member("source", 1, { classroomId: "class-b" });
    const rows = [source, member("occupied", 2)];
    expect(placementSeatTargetError(source, classroom, target(2), rows)).toBe("SEAT_OCCUPIED");
    expect(placementSeatTargetError(source, classroom, target(3), rows)).toBeNull();
    expect(placementSeatTargetError(source, { ...classroom, activeCount: 4 }, target(3), rows)).toBe("CLASS_FULL");
  });
  it("rejects term, grade and course mismatches, including return-to-pending groups", () => {
    const source = member("source", 1);
    expect(placementSeatTargetError(source, null, { ...target(null), termId: "next" }, [])).toBe("CLASS_TARGET_MISMATCH");
    expect(placementSeatTargetError(source, null, { ...target(null), grade: 5 }, [])).toBe("CLASS_TARGET_MISMATCH");
    expect(placementSeatTargetError(source, { ...classroom, id: "class-b", courseId: "other" }, target(2), [])).toBe("CLASS_TARGET_MISMATCH");
    expect(placementSeatTargetError(source, { ...classroom, termId: "next" }, target(2), [])).toBe("CLASS_TARGET_MISMATCH");
  });
  it("checks seat bounds and keeps withdrawal immutable while allowing paused moves", () => {
    const source = member("source", 1);
    for (const seat of [null, 0, -1, 1.5, 5]) expect(placementSeatTargetError(source, classroom, target(seat), [])).toBe("INVALID_SEAT");
    expect(placementSeatTargetError(source, null, target(1), [])).toBe("INVALID_SEAT");
    expect(placementSeatTargetError({ ...source, status: "withdrawn" }, null, target(null), [])).toBe("ENROLLMENT_CANCELLED");
    expect(placementSeatTargetError({ ...source, status: "paused" }, classroom, target(2), [source])).toBeNull();
    expect(placementSeatTargetError(source, null, target(null), [])).toBeNull();
  });
  it("keeps inferred and duplicate display positions out of seat swaps", () => {
    const source = member("source", 4);
    const missing = member("missing", null);
    expect(placementSeatTargetError(source, classroom, target(1), [source, missing])).toBe("PLACEMENT_CHANGED");
    const duplicate = [member("first", 2), member("second", 2), source];
    expect(placementSeatTargetError(source, classroom, target(1), duplicate)).toBe("PLACEMENT_CHANGED");
    expect(placementSeatTargetError(source, classroom, target(2), duplicate)).toBe("PLACEMENT_CHANGED");
    expect(placementSeatTargetError(duplicate[1], classroom, target(3), duplicate)).toBe("PLACEMENT_CHANGED");
    expect(placementSeatTargetError(missing, classroom, target(3), [source, missing])).toBeNull();
    expect(missing.seat).toBeNull();
  });
});
