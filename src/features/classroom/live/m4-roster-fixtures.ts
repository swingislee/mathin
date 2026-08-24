import type { SessionRosterState } from "../types";

export const M4A_STAR_STUDENT_ID = "a1000000-0000-4000-8000-000000000002";

interface FixtureNames {
  claimed: string;
  unclaimed: string;
  seated: string;
  newlyEnrolled: string;
}

export function buildM4aRosterFixtures(names: FixtureNames): {
  base: SessionRosterState;
  changed: SessionRosterState;
  refreshed: SessionRosterState;
} {
  const baseEntries = [
    {
      studentId: "a1000000-0000-4000-8000-000000000001",
      name: names.claimed,
      seatPosition: 0,
      userId: "b1000000-0000-4000-8000-000000000001",
    },
    {
      studentId: M4A_STAR_STUDENT_ID,
      name: names.unclaimed,
      seatPosition: 5,
      userId: null,
    },
    {
      studentId: "a1000000-0000-4000-8000-000000000003",
      name: names.seated,
      seatPosition: 9,
      userId: "b1000000-0000-4000-8000-000000000003",
    },
  ] satisfies SessionRosterState["entries"];

  const base: SessionRosterState = {
    sessionId: "c1000000-0000-4000-8000-000000000001",
    revision: 7,
    frozen: true,
    sourceHash: "a".repeat(64),
    currentSourceHash: "a".repeat(64),
    hasDifference: false,
    frozenAt: "2026-08-25T00:00:00.000Z",
    revisionCreatedAt: "2026-08-25T00:00:00.000Z",
    starEventSchema: 2,
    entries: baseEntries,
  };

  return {
    base,
    changed: {
      ...base,
      currentSourceHash: "b".repeat(64),
      hasDifference: true,
    },
    refreshed: {
      ...base,
      revision: 8,
      sourceHash: "b".repeat(64),
      currentSourceHash: "b".repeat(64),
      hasDifference: false,
      revisionCreatedAt: "2026-08-25T00:05:00.000Z",
      entries: [
        baseEntries[0],
        { ...baseEntries[1], seatPosition: 6 },
        baseEntries[2],
        {
          studentId: "a1000000-0000-4000-8000-000000000004",
          name: names.newlyEnrolled,
          seatPosition: 10,
          userId: null,
        },
      ],
    },
  };
}
