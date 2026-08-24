import type { SessionEvent } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StarV2Payload {
  schemaVersion: 2;
  studentId: string;
  awardId: string;
}

export interface StarLedger {
  /** Legacy v1 target key: claimed student's profiles/user UUID. */
  legacyCounts: Record<string, number>;
  /** Stable students.id -> award IDs, in the local observation order used for explicit undo. */
  awardsByStudent: Record<string, string[]>;
  /** Stable students.id -> revoked award IDs. A revoke may arrive before its award. */
  revocationsByStudent: Record<string, string[]>;
}

export interface StarRosterIdentity {
  studentId: string;
  userId: string | null;
}

export function emptyStarLedger(): StarLedger {
  return {
    legacyCounts: {},
    awardsByStudent: {},
    revocationsByStudent: {},
  };
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

export function parseStarV2Payload(payload: Record<string, unknown>): StarV2Payload | null {
  if (payload.schemaVersion !== 2) return null;
  const studentId = uuid(payload.studentId);
  const awardId = uuid(payload.awardId);
  return studentId && awardId ? { schemaVersion: 2, studentId, awardId } : null;
}

function appendUnique(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value];
}

/**
 * Fold legacy counters and v2 award/revocation sets without relying on transport order.
 * Unknown schema versions and malformed UUIDs fail closed.
 */
export function reduceStarLedger(
  ledger: StarLedger,
  event: Pick<SessionEvent, "type" | "payload">,
): StarLedger {
  if (event.type !== "star" && event.type !== "star_undo") return ledger;

  const v2 = parseStarV2Payload(event.payload);
  if (v2) {
    if (event.type === "star") {
      const awards = ledger.awardsByStudent[v2.studentId] ?? [];
      if (awards.includes(v2.awardId)) return ledger;
      return {
        ...ledger,
        awardsByStudent: {
          ...ledger.awardsByStudent,
          [v2.studentId]: appendUnique(awards, v2.awardId),
        },
      };
    }
    const revocations = ledger.revocationsByStudent[v2.studentId] ?? [];
    if (revocations.includes(v2.awardId)) return ledger;
    return {
      ...ledger,
      revocationsByStudent: {
        ...ledger.revocationsByStudent,
        [v2.studentId]: appendUnique(revocations, v2.awardId),
      },
    };
  }

  // v1 was unversioned. Explicit unknown versions must not be reinterpreted as legacy.
  if (event.payload.schemaVersion !== undefined && event.payload.schemaVersion !== 1) return ledger;
  const targetUserId = uuid(event.payload.studentId);
  if (!targetUserId) return ledger;
  const current = ledger.legacyCounts[targetUserId] ?? 0;
  const next = event.type === "star" ? current + 1 : Math.max(0, current - 1);
  if (next === current) return ledger;
  return {
    ...ledger,
    legacyCounts: { ...ledger.legacyCounts, [targetUserId]: next },
  };
}

export function starCountForRosterEntry(
  ledger: StarLedger,
  identity: StarRosterIdentity,
): number {
  const legacyTargets = identity.userId && identity.userId !== identity.studentId
    ? [identity.userId, identity.studentId]
    : [identity.studentId];
  const legacy = legacyTargets.reduce(
    (total, target) => total + (ledger.legacyCounts[target] ?? 0),
    0,
  );
  const revoked = new Set(ledger.revocationsByStudent[identity.studentId] ?? []);
  const v2 = (ledger.awardsByStudent[identity.studentId] ?? [])
    .filter((awardId) => !revoked.has(awardId)).length;
  return legacy + v2;
}

/** The concrete still-effective award selected by the teacher's next undo action. */
export function latestActiveAwardId(ledger: StarLedger, studentId: string): string | null {
  const revoked = new Set(ledger.revocationsByStudent[studentId] ?? []);
  return (ledger.awardsByStudent[studentId] ?? []).findLast((awardId) => !revoked.has(awardId)) ?? null;
}

export function buildStarLedger(events: readonly Pick<SessionEvent, "type" | "payload">[]): StarLedger {
  return events.reduce(reduceStarLedger, emptyStarLedger());
}
