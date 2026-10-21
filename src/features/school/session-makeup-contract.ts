import { z } from "zod";
import { ATTENDANCE_STATUSES } from "./learning";
import { LEARNING_CHECK_STATUSES } from "./session-learning-contract";

const checkSchema = z.object({ id: z.string().uuid(), title: z.string().trim().min(1).max(100) });
export const makeupRecordInputSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }), durationMin: z.number().int().min(1).max(480),
  status: z.enum(["planned", "completed"]), note: z.string().max(2000),
  checks: z.array(checkSchema).max(30),
  students: z.array(z.object({
    studentId: z.string().uuid(), name: z.string(), attendance: z.enum(ATTENDANCE_STATUSES).nullable(), note: z.string().max(1000),
    results: z.array(z.object({ checkId: z.string().uuid(), status: z.enum(LEARNING_CHECK_STATUSES) })).max(30),
  })).min(1).max(200),
});
export const makeupRecordSchema = makeupRecordInputSchema.extend({
  id: z.string().uuid(), revision: z.number().int(), recordedBy: z.string(), updatedAt: z.string(),
});
export const sessionMakeupsSchema = z.object({
  students: z.array(z.object({ id: z.string().uuid(), name: z.string(), attendance: z.enum(ATTENDANCE_STATUSES).nullable() })),
  checks: z.array(checkSchema), records: z.array(makeupRecordSchema),
});
export type MakeupRecord = z.infer<typeof makeupRecordSchema>;
export type SessionMakeups = z.infer<typeof sessionMakeupsSchema>;
