import { z } from "zod";
import { datetime, intInRange, requiredText, text, uuid } from "./schemas";

// Optional Select fields may arrive as either the explicit null used by the
// current wizard or an empty string from an older/hydrating client. Normalize
// both representations before the RPC boundary.
const optionalFormUuid = z
  .union([uuid, z.literal("")])
  .nullable()
  .transform((value) => value || null);

export const buildClassSchema = z.object({
  name: requiredText(100),
  courseId: uuid.nullable(),
  capacity: intInRange(1, 500).nullable(),
  room: text(100),
  primaryTeacherId: uuid,
  learningSupportId: optionalFormUuid,
  schoolTermId: uuid,
  purpose: z.enum(["production", "test"]),
  activateNow: z.boolean(),
  sessions: z
    .array(
      z.object({
        lectureId: uuid,
        no: intInRange(1, 999),
        name: text(100),
        scheduledAt: datetime,
        durationMin: intInRange(1, 600),
      }),
    )
    .max(200),
}).superRefine((value, ctx) => {
  if (value.courseId === null && value.sessions.length > 0) {
    ctx.addIssue({ code: "custom", path: ["sessions"], message: "INVALID_SCHEDULE" });
  }
  if (value.learningSupportId !== null && value.learningSupportId === value.primaryTeacherId) {
    ctx.addIssue({ code: "custom", path: ["learningSupportId"], message: "INVALID_STAFF" });
  }
});
