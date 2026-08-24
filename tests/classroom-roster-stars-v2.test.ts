import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSessionReport } from "@/features/classroom/report";
import { parseSessionRosterState } from "@/features/classroom/roster";
import { buildM4aRosterFixtures, M4A_STAR_STUDENT_ID } from "@/features/classroom/live/m4-roster-fixtures";
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
const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

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

  it("freezes the enrollment roster and guards versioned star writes in the database", () => {
    const migration = source("supabase/migrations/20260825000200_classroom_roster_star_v2.sql");

    expect(migration).toContain("create table public.session_roster_revisions");
    expect(migration).toContain("create table public.session_roster_entries");
    expect(migration).toMatch(/join public\.enrollments[\s\S]*enrollment_row\.status = 'active'/);
    expect(migration).toContain("student_id uuid not null references public.students(id)");
    expect(migration).toContain("user_id uuid references public.profiles(id) on delete set null");
    expect(migration).toContain("create function public.freeze_session_roster");
    expect(migration).toContain("create function public.refresh_session_roster");
    expect(migration).toContain("current_hash <> p_expected_source_hash");
    expect(migration).toContain("if session_row.roster_revision > 0 then");
    expect(migration).toContain("create function public.is_valid_session_star_event");
    expect(migration).toContain("entry_row.student_id = target_id");
    expect(migration).toContain("entry_row.user_id = target_id");
    expect(migration).toContain("public.student_star_total(my_student.id)");
    expect(migration).toContain("select distinct event_row.session_id, event_row.payload ->> 'awardId'");
    expect(migration).toContain("'teaching.classroom_layout_v2', 1, false");
  });

  it("parses only internally consistent frozen-roster responses", () => {
    const response = {
      sessionId: SESSION_ID,
      revision: 2,
      frozen: true,
      sourceHash: "a".repeat(64),
      currentSourceHash: "b".repeat(64),
      hasDifference: true,
      frozenAt: "2026-08-25T00:00:00+00:00",
      revisionCreatedAt: "2026-08-25T00:01:00+00:00",
      starEventSchema: 2,
      entries: roster,
    };

    expect(parseSessionRosterState(response).entries).toEqual(roster);
    expect(() => parseSessionRosterState({ ...response, frozen: false })).toThrow(
      "SESSION_ROSTER_RESPONSE_INVALID",
    );
    expect(() => parseSessionRosterState({ ...response, entries: [
      { ...roster[0], seatPosition: 60 },
    ] })).toThrow("SESSION_ROSTER_RESPONSE_INVALID");
  });

  it("wires the frozen roster and one serialized v2 writer into the live classroom", () => {
    const actions = source("src/features/classroom/actions.ts");
    const readerMigration = source("supabase/migrations/20260825000300_classroom_star_v2_readers.sql");
    const backfillMigration = source("supabase/migrations/20260825000400_classroom_open_roster_backfill.sql");
    const schemaReloadMigration = source("supabase/migrations/20260825000500_classroom_roster_rpc_schema_reload.sql");
    const route = source("src/app/[locale]/classroom/[classId]/session/[sessionId]/live/page.tsx");
    const shell = source("src/features/classroom/live/LiveShell.tsx");
    const learning = source("src/features/school/session-learning.ts");
    const featureContract = source("src/features/school/organization-settings-contract.ts");

    expect(actions).toContain('isFeatureEnabled("teaching.classroom_layout_v2")');
    expect(actions).toContain('supabase.rpc("freeze_session_roster"');
    expect(actions).toContain('supabase.rpc("refresh_session_roster"');
    expect(readerMigration).toContain("create function public.get_student_star_total");
    expect(readerMigration).toContain("public.can_access_student(p_student_id, uid)");
    expect(backfillMigration).toContain("session_row.started_at is not null");
    expect(backfillMigration).toContain("session_row.ended_at is null");
    expect(backfillMigration).toContain("star_event_schema = 1");
    expect(schemaReloadMigration).toContain("notify pgrst, 'reload schema'");
    expect(actions).toMatch(/reopenClassSession[\s\S]*freeze_session_roster/);
    expect(route).toContain("getSessionRoster(sessionId)");
    expect(route).toContain('isFeatureEnabled("teaching.classroom_layout_v2")');
    expect(learning).toContain("getSessionRoster(sessionId)");
    expect(featureContract).toContain('"teaching.classroom_layout_v2"');
    expect(shell).toContain("starQueueRef.current = starQueueRef.current");
    expect(shell).toContain("latestActiveAwardId(starLedgerRef.current, student.studentId)");
    expect(shell).toContain("payload = { schemaVersion: 2, studentId: student.studentId, awardId }");
    expect(shell).not.toContain('append("star", { studentId: student.userId })');
  });

  it("ships only the three new M4a visual acceptance objects by default", () => {
    const fixtures = buildM4aRosterFixtures({
      claimed: "claimed",
      unclaimed: "unclaimed",
      seated: "seated",
      newlyEnrolled: "new",
    });
    const route = source("src/app/[locale]/classroom/[classId]/session/[sessionId]/live/page.tsx");
    const shell = source("src/features/classroom/live/LiveShell.tsx");
    const acceptanceDock = source("src/features/classroom/live/DevelopmentAcceptanceDock.tsx");

    expect(fixtures.base.entries.find((student) => student.studentId === M4A_STAR_STUDENT_ID)).toMatchObject({
      userId: null,
      seatPosition: 5,
    });
    expect(fixtures.changed).toMatchObject({ revision: 7, hasDifference: true });
    expect(fixtures.changed.entries).toEqual(fixtures.base.entries);
    expect(fixtures.refreshed).toMatchObject({ revision: 8, hasDifference: false });
    expect(fixtures.refreshed.entries).toHaveLength(4);
    expect(route).toContain('acceptance === "m3b" ? "m3b" : "m4a"');
    expect(shell).toContain("data-m4-roster-identity");
    expect(shell).toContain("data-m4-star-set");
    expect(shell).toContain("data-m4-roster-refresh");
    expect(shell).toContain('acceptanceFixture === "m3b"');
    expect(shell).toContain("<DevelopmentAcceptanceDock");
    expect(acceptanceDock).toContain("fixed left-");
    expect(acceptanceDock).toContain("data-development-acceptance-dock");
    expect(acceptanceDock).toContain("aria-expanded={expanded}");
  });
});
