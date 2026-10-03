import { z } from "zod";
import { materialSelectionSchema } from "../class-material-contract";
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
  roomId: uuid.nullable(),
  primaryTeacherId: uuid,
  learningSupportId: optionalFormUuid,
  schoolTermId: uuid,
  purpose: z.enum(["production", "test"]),
  offeringType: z.enum(["long_term_formal", "short_term_topic"]),
  activateNow: z.boolean(),
  materialSelection: materialSelectionSchema.nullable().optional(),
  sessions: z
    .array(
      z.object({
        lectureId: uuid.nullable(),
        no: intInRange(1, 999).nullable(),
        name: requiredText(100),
        scheduledAt: datetime,
        durationMin: intInRange(1, 600),
        closedDayReason: text(500).default(""),
      }),
    )
    .max(200),
}).superRefine((value, ctx) => {
  if (value.courseId === null && value.materialSelection) {
    ctx.addIssue({ code: "custom", path: ["materialSelection"], message: "MATERIAL_REQUIRES_COURSE" });
  }
  const invalidSessionBinding = value.sessions.some((session) => value.courseId === null
    ? session.lectureId !== null || session.no !== null
    : session.lectureId === null || session.no === null);
  if (invalidSessionBinding) {
    ctx.addIssue({ code: "custom", path: ["sessions"], message: "INVALID_SCHEDULE" });
  }
  if (value.learningSupportId !== null && value.learningSupportId === value.primaryTeacherId) {
    ctx.addIssue({ code: "custom", path: ["learningSupportId"], message: "INVALID_STAFF" });
  }
});
