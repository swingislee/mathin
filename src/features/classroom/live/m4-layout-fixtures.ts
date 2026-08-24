import type { SessionEvent, SessionRosterState } from "../types";

export const M4B_LONG_NAME_STUDENT_ID = "a4000000-0000-4000-8000-000000000003";

interface M4bFixtureNames {
  student: (seat: number) => string;
  longName: string;
  unclaimed: string;
}

function roster(count: number, names: M4bFixtureNames): SessionRosterState {
  return {
    sessionId: "c4000000-0000-4000-8000-000000000001",
    revision: 12,
    frozen: true,
    sourceHash: "c".repeat(64),
    currentSourceHash: "c".repeat(64),
    hasDifference: false,
    frozenAt: "2026-08-25T00:00:00.000Z",
    revisionCreatedAt: "2026-08-25T00:00:00.000Z",
    starEventSchema: 2,
    entries: Array.from({ length: count }, (_, index) => {
      const seat = index + 1;
      const studentId = `a4000000-0000-4000-8000-${String(seat).padStart(12, "0")}`;
      return {
        studentId,
        name: seat === 3 ? names.longName : seat === 6 ? names.unclaimed : names.student(seat),
        seatPosition: index,
        userId: seat === 6 ? null : `b4000000-0000-4000-8000-${String(seat).padStart(12, "0")}`,
      };
    }),
  };
}

export function buildM4bRosterFixtures(names: M4bFixtureNames): Record<"8" | "20" | "30", SessionRosterState> {
  return {
    "8": roster(8, names),
    "20": roster(20, names),
    "30": roster(30, names),
  };
}

/** 10/11/13/27-star examples exercise the visual contract without touching a database. */
export function buildM4bStarFixtureEvents(sessionId: string, userId: string): SessionEvent[] {
  const counts = [10, 11, 13, 27];
  let seq = 0;
  return counts.flatMap((count, studentIndex) => Array.from({ length: count }, () => {
    seq += 1;
    return {
      id: `e4000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      sessionId,
      userId,
      deviceId: "m4b-layout-fixture",
      seq,
      type: "star" as const,
      payload: {
        schemaVersion: 2,
        studentId: `a4000000-0000-4000-8000-${String(studentIndex + 1).padStart(12, "0")}`,
        awardId: `d4000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      },
      at: "2026-08-25T00:00:00.000Z",
    };
  }));
}
