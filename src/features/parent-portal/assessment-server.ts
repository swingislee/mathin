import "server-only";
import { z } from "zod";
import {
  assessmentAvailabilitySchema, assessmentCommandSchema, assessmentOverviewSchema, assessmentQuerySchema, assessmentRequestSchema, assessmentSlotsQuerySchema,
} from "./assessment-contract";
import { authorize, PortalError, readJson, requireResult, response } from "./server";

const conflictCodes = new Set([
  "NO_LINKED_LEAD", "AMBIGUOUS_LINKED_LEAD", "LEAD_UNAVAILABLE", "ACTIVE_INVITATION",
  "NO_ELIGIBLE_TEACHER", "IDEMPOTENCY_CONFLICT", "TIME_UNAVAILABLE",
  "SLOT_UNAVAILABLE", "CAMPUS_UNAVAILABLE",
]);

function assessmentResult<T>(result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error && conflictCodes.has(result.error.message)) throw new PortalError("CONFLICT");
  return requireResult(result);
}

function projection<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new PortalError("UNAVAILABLE");
  return parsed.data;
}

export async function assessmentGet(request: Request) {
  const query = new URL(request.url).searchParams;
  if (query.getAll("participant").length > 1) throw new PortalError("VALIDATION");
  const input = assessmentQuerySchema.parse(Object.fromEntries(query));
  const { db } = await authorize(request);
  const result = projection(assessmentOverviewSchema, assessmentResult(await db.rpc("parent_assessment_overview", {
    p_student_id: input.participant,
  })));
  if (result.participantId !== input.participant) throw new PortalError("UNAVAILABLE");
  return response(result);
}

export async function assessmentPost(request: Request) {
  const input = assessmentCommandSchema.parse(await readJson(request));
  const { db } = await authorize(request);
  const result = input.action === "book"
    ? await db.rpc("book_parent_assessment_slot", {
      p_request_id: input.id, p_student_id: input.participantId, p_slot_id: input.slotId,
      p_subjects: input.subjects, p_grade: input.grade,
    })
    : input.action === "request"
    ? await db.rpc("request_parent_assessment", {
      p_request_id: input.id, p_student_id: input.participantId,
      p_assessor_id: input.teacherId, p_parent_time_options: input.parentTimeOptions,
    })
    : await db.rpc("confirm_parent_assessment", {
      p_invitation_id: input.id, p_student_id: input.participantId,
      p_time_option: input.timeOption, p_expected_updated_at: input.expectedUpdatedAt,
    });
  const value = projection(assessmentRequestSchema, assessmentResult(result));
  if (value.id !== input.id || value.participantId !== input.participantId) throw new PortalError("UNAVAILABLE");
  if (input.action === "confirm" && (!["confirmed", "completed"].includes(value.state) || !value.scheduledAt)) {
    throw new PortalError("UNAVAILABLE");
  }
  if (input.action === "book" && (!value.booking || value.booking.slotId !== input.slotId
    || value.booking.grade !== input.grade || value.booking.mode !== input.mode
    || [...value.booking.subjects].sort().join(",") !== [...input.subjects].sort().join(",")
    || !["confirmed", "completed", "cancelled"].includes(value.state)
    || (value.state !== "cancelled" && !value.scheduledAt))) throw new PortalError("UNAVAILABLE");
  return response(value, input.action === "confirm" ? 200 : 201);
}

export async function assessmentSlotsGet(request: Request) {
  const query = new URL(request.url).searchParams;
  if (["participant", "subjects", "grade"].some(key => query.getAll(key).length !== 1)) throw new PortalError("VALIDATION");
  const input = assessmentSlotsQuerySchema.parse(Object.fromEntries(query));
  const { db } = await authorize(request);
  const result = projection(assessmentAvailabilitySchema, assessmentResult(await db.rpc("parent_assessment_availability", {
    p_student_id: input.participant, p_subjects: input.subjects, p_grade: input.grade,
  })));
  if (result.participantId !== input.participant) throw new PortalError("UNAVAILABLE");
  return response(result);
}
