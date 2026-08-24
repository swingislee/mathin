import { describe, expect, it } from "vitest";
import { buildSessionReport } from "@/features/classroom/report";
import {
  buildStarLedger,
  emptyStarLedger,
  latestActiveAwardId,
  reduceStarLedger,
  starCountForRosterEntry,
} from "@/features/classroom/stars";
import type { SessionEvent, SessionEventType, SessionRosterEntry } from "@/features/classroom/types";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const TEACHER_ID = "22222222-2222-4222-8222-222222222222";
const STUDENT_ID = "33333333-3333-4333-8333-333333333333";
const UNCLAIMED_STUDENT_ID = "44444444-4444-4444-8444-444444444444";
const STUDENT_USER_ID = "55555555-5555-4555-8555-555555555555";
const AWARD_A = "66666666-6666-4666-8666-666666666666";
const AWARD_B = "77777777-7777-4777-8777-777777777777";

function event(type: SessionEventType, payload: Record<string, unknown>, userId = TEACHER_ID): SessionEvent {
  return {
    id: crypto.randomUUID(),
    sessionId: SESSION_ID,
    userId,
    deviceId: "test-device",
    seq: 1,
    type,
    payload,
    at: "2026-08-25T00:00:00.000Z",
  };
}

const roster: SessionRosterEntry[] = [
  { studentId: STUDENT_ID, userId: STUDENT_USER_ID, name: "Claimed", seatPosition: 3 },
  { studentId: UNCLAIMED_STUDENT_ID, userId: null, name: "Unclaimed", seatPosition: 7 },
];

describe("M4a roster identity and star v2", () => {
  it("converges duplicate and reverse-order award/revoke events", () => {
    const revokeBeforeAward = event("star_undo", {
      schemaVersion: 2,
      studentId: STUDENT_ID,
      awardId: AWARD_A,
    });
    const awardA = event("star", { schemaVersion: 2, studentId: STUDENT_ID, awardId: AWARD_A });
    const awardB = event("star", { schemaVersion: 2, studentId: STUDENT_ID, awardId: AWARD_B });
    const ledger = buildStarLedger([
      revokeBeforeAward,
      awardA,
      awardA,
      revokeBeforeAward,
      awardB,
    ]);

    expect(starCountForRosterEntry(ledger, roster[0])).toBe(1);
    expect(latestActiveAwardId(ledger, STUDENT_ID)).toBe(AWARD_B);
  });

  it("double-reads legacy user targets and v2 stable student targets", () => {
    const ledger = buildStarLedger([
      event("star", { studentId: STUDENT_USER_ID }),
      event("star", { studentId: STUDENT_USER_ID }),
      event("star_undo", { studentId: STUDENT_USER_ID }),
      event("star", { schemaVersion: 2, studentId: STUDENT_ID, awardId: AWARD_A }),
      event("star", { schemaVersion: 2, studentId: STUDENT_ID, awardId: AWARD_B }),
      event("star_undo", { schemaVersion: 2, studentId: STUDENT_ID, awardId: AWARD_A }),
    ]);

    expect(starCountForRosterEntry(ledger, roster[0])).toBe(2);
  });

  it("fails closed for malformed IDs and unknown schema versions", () => {
    const initial = emptyStarLedger();
    const malformed = reduceStarLedger(initial, event("star", {
      schemaVersion: 2,
      studentId: "not-a-uuid",
      awardId: AWARD_A,
    }));
    const unknown = reduceStarLedger(initial, event("star", {
      schemaVersion: 3,
      studentId: STUDENT_USER_ID,
    }));

    expect(malformed).toBe(initial);
    expect(unknown).toBe(initial);
  });

  it("keeps unclaimed active-enrollment students in reports", () => {
    const report = buildSessionReport(roster, [
      event("star", { schemaVersion: 2, studentId: UNCLAIMED_STUDENT_ID, awardId: AWARD_A }),
      event("hand", { up: true }, STUDENT_USER_ID),
      event("session_ctl", { action: "quiz_open", quizId: "quiz-1", options: 3 }),
      event("answer", { quizId: "quiz-1", choice: 1 }, STUDENT_USER_ID),
    ]);

    expect(report.rows).toEqual([
      expect.objectContaining({ studentId: STUDENT_ID, userId: STUDENT_USER_ID, handRaises: 1, answeredCount: 1 }),
      expect.objectContaining({ studentId: UNCLAIMED_STUDENT_ID, userId: null, stars: 1, handRaises: null, answeredCount: null }),
    ]);
  });
});
