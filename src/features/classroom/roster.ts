import { z } from "zod";
import type { SessionRosterState } from "./types";

const hash = z.string().regex(/^[0-9a-f]{64}$/);

const rosterStateSchema = z.object({
  sessionId: z.string().uuid(),
  revision: z.number().int().positive().nullable(),
  frozen: z.boolean(),
  sourceHash: hash.nullable(),
  currentSourceHash: hash,
  hasDifference: z.boolean(),
  frozenAt: z.string().datetime({ offset: true }).nullable(),
  revisionCreatedAt: z.string().datetime({ offset: true }).nullable(),
  starEventSchema: z.union([z.literal(1), z.literal(2)]),
  entries: z.array(z.object({
    studentId: z.string().uuid(),
    name: z.string(),
    seatPosition: z.number().int().min(0).max(59).nullable(),
    userId: z.string().uuid().nullable(),
  })).max(60),
}).superRefine((value, context) => {
  if (value.frozen !== (value.revision !== null)) {
    context.addIssue({ code: "custom", message: "frozen revision mismatch" });
  }
  if (value.frozen !== (value.sourceHash !== null && value.frozenAt !== null)) {
    context.addIssue({ code: "custom", message: "frozen metadata mismatch" });
  }
  if (!value.frozen && value.hasDifference) {
    context.addIssue({ code: "custom", message: "unfrozen roster cannot differ" });
  }
});

export function parseSessionRosterState(value: unknown): SessionRosterState {
  const parsed = rosterStateSchema.safeParse(value);
  if (!parsed.success) throw new Error("SESSION_ROSTER_RESPONSE_INVALID");
  return parsed.data;
}
