import { z } from "zod";
import type {
  AssessmentCommand, ParentAssessmentOverview, ParentAssessmentRequest,
} from "../../../contracts/parent-api/portal";

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const dateTime = z.iso.datetime({ offset: true });
const calendarDate = z.iso.date();
const optionPattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])@(09:50|10:00|14:00|16:00|17:00|17:30|19:20|after_school)$/;
const timeOption = z.string().regex(optionPattern).refine(
  (value) => !value.startsWith("0000-") && calendarDate.safeParse(value.split("@")[0]).success,
);
const exactTimeOption = timeOption.refine((value) => !value.endsWith("@after_school"));
const uniqueOptions = (exact = false) => z.array(exact ? exactTimeOption : timeOption)
  .max(84).refine((values) => new Set(values).size === values.length);

export const assessmentQuerySchema = z.object({ participant: uuid }).strict();

export const assessmentCommandSchema: z.ZodType<AssessmentCommand> = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request"), id: uuid, participantId: uuid, teacherId: uuid,
    parentTimeOptions: uniqueOptions().min(1),
  }).strict(),
  z.object({
    action: z.literal("confirm"), id: uuid, participantId: uuid,
    timeOption: exactTimeOption, expectedUpdatedAt: dateTime,
  }).strict(),
]);

// 输出逐字段解析，丢弃 RPC 未来可能附带的内部字段，保持跨端合同边界。
const teacherSchema = z.object({ id: uuid, displayName: z.string() });
export const assessmentRequestSchema: z.ZodType<ParentAssessmentRequest> = z.object({
  id: uuid, participantId: uuid, teacher: teacherSchema.nullable(),
  state: z.enum(["coordinating_time", "awaiting_teacher", "awaiting_parent", "confirmed", "completed", "cancelled"]),
  parentTimeOptions: uniqueOptions(), teacherTimeOptions: uniqueOptions(), sharedTimeOptions: uniqueOptions(true),
  proposedStartsAt: dateTime.nullable(), scheduledAt: dateTime.nullable(), updatedAt: dateTime,
  canConfirm: z.boolean(),
}).superRefine((value, context) => {
  if (value.state !== "awaiting_parent" && value.proposedStartsAt !== null) {
    context.addIssue({ code: "custom", path: ["proposedStartsAt"], message: "INVALID_ASSESSMENT_PROJECTION" });
  }
  if (!["confirmed", "completed"].includes(value.state) && value.scheduledAt !== null) {
    context.addIssue({ code: "custom", path: ["scheduledAt"], message: "INVALID_ASSESSMENT_PROJECTION" });
  }
  if (value.sharedTimeOptions.some((option, index, options) =>
    !value.parentTimeOptions.includes(option) || !value.teacherTimeOptions.includes(option)
    || (index > 0 && options[index - 1] > option))) {
    context.addIssue({ code: "custom", path: ["sharedTimeOptions"], message: "INVALID_ASSESSMENT_PROJECTION" });
  }
  if (value.canConfirm && (value.state !== "awaiting_parent" || !value.teacher || !value.sharedTimeOptions.length)) {
    context.addIssue({ code: "custom", path: ["canConfirm"], message: "INVALID_ASSESSMENT_PROJECTION" });
  }
});

export const assessmentOverviewSchema: z.ZodType<ParentAssessmentOverview> = z.object({
  participantId: uuid, timeZone: z.literal("Asia/Shanghai"),
  eligibility: z.object({
    canRequest: z.boolean(),
    reason: z.enum(["NO_LINKED_LEAD", "AMBIGUOUS_LINKED_LEAD", "LEAD_UNAVAILABLE", "ACTIVE_INVITATION", "NO_ELIGIBLE_TEACHER"]).nullable(),
  }).refine((value) => value.canRequest === (value.reason === null)),
  teachers: z.array(teacherSchema).max(100), requests: z.array(assessmentRequestSchema).max(100),
}).superRefine((value, context) => {
  if (value.requests.some((request) => request.participantId !== value.participantId)) {
    context.addIssue({ code: "custom", path: ["requests"], message: "INVALID_ASSESSMENT_PARTICIPANT" });
  }
  if ((value.eligibility.canRequest && !value.teachers.length)
    || new Set(value.teachers.map((teacher) => teacher.id)).size !== value.teachers.length
    || new Set(value.requests.map((request) => request.id)).size !== value.requests.length) {
    context.addIssue({ code: "custom", message: "INVALID_ASSESSMENT_PROJECTION" });
  }
});
