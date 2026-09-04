"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { getMyPerms } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parse, text, uuid } from "./actions/schemas";
import { ASSESSMENT_BANDS } from "./activity-workflow-contract";
import {
  TEACHER_ASSESSMENT_OUTCOMES,
  type TeacherAssessmentOutcome,
  type TeacherAssessmentSummary,
} from "./teacher-assessment-contract";

type UntypedRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return (supabase.rpc as UntypedRpc).bind(supabase);
}

async function authorizedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  if (!(await getMyPerms(user.id)).has("review.write")) throw new Error("FORBIDDEN");
  return supabase;
}

const summarySchema = z.object({
  answeredCount: z.number().int(),
  questionCount: z.number().int(),
  score: z.number().int(),
  totalScore: z.number().int(),
  suggestedBand: z.enum(ASSESSMENT_BANDS).nullable(),
  completedAt: z.string().nullable().optional(),
});

const questionInputSchema = z.object({
  registrationId: uuid,
  questionId: uuid,
  outcome: z.enum(TEACHER_ASSESSMENT_OUTCOMES).nullable(),
  score: z.number().int().min(0).max(1000).nullable(),
  note: text(1000),
});

const observationInputSchema = z.object({
  registrationId: uuid,
  observation: text(3000),
});

const ERROR_CODES = [
  "VALIDATION",
  "FORBIDDEN",
  "FORBIDDEN_SCOPE",
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "INVITATION_NOT_CONFIRMED",
  "PARTICIPATION_NOT_ASSESSABLE",
  "ASSESSMENT_PAPER_REQUIRED",
  "ASSESSMENT_PAPER_NOT_PUBLISHED",
  "ASSESSMENT_PAPER_INVALID_TOTAL",
  "ASSESSMENT_PAPER_BINDING_LOCKED",
  "ASSESSMENT_QUESTION_NOT_IN_PAPER",
  "INVALID_ASSESSMENT_QUESTION_RESULT",
  "INVALID_ASSESSMENT_QUESTION_SCORE",
  "INVALID_TEACHER_OBSERVATION",
  "ASSESSMENT_QUESTIONS_INCOMPLETE",
];

function summaryFrom(data: unknown): TeacherAssessmentSummary {
  const parsed = summarySchema.parse(data);
  return parsed as TeacherAssessmentSummary;
}

export async function startInvitationTeacherAssessmentAction(
  invitationId: string,
): Promise<ActionResult<{ registrationId: string }>> {
  try {
    const id = parse(uuid, invitationId);
    const supabase = await authorizedClient();
    const result = await rpc(supabase)("start_invitation_teacher_assessment", {
      p_invitation_id: id,
    });
    if (result.error) throw new Error(result.error.message);
    const registrationId = parse(uuid, result.data);
    return { ok: true, data: { registrationId } };
  } catch (error) {
    return actionError(error, ERROR_CODES);
  }
}

export async function bindTeacherAssessmentPaperAction(input: {
  registrationId: string;
  paperVersionId: string;
}): Promise<ActionResult> {
  try {
    const value = parse(z.object({ registrationId: uuid, paperVersionId: uuid }), input);
    const supabase = await authorizedClient();
    const result = await rpc(supabase)("bind_teacher_assessment_paper", {
      p_registration_id: value.registrationId,
      p_paper_version_id: value.paperVersionId,
    });
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ERROR_CODES);
  }
}

export async function saveTeacherAssessmentQuestionAction(input: {
  registrationId: string;
  questionId: string;
  outcome: TeacherAssessmentOutcome | null;
  score: number | null;
  note: string;
}): Promise<ActionResult<TeacherAssessmentSummary>> {
  try {
    const value = parse(questionInputSchema, input);
    const supabase = await authorizedClient();
    const result = await rpc(supabase)("save_teacher_assessment_question", {
      p_registration_id: value.registrationId,
      p_question_id: value.questionId,
      p_outcome: value.outcome ?? undefined,
      p_score: value.score ?? undefined,
      p_note: value.note,
    });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: summaryFrom(result.data) };
  } catch (error) {
    return actionError<TeacherAssessmentSummary>(error, ERROR_CODES);
  }
}

export async function saveTeacherAssessmentObservationAction(input: {
  registrationId: string;
  observation: string;
}): Promise<ActionResult> {
  try {
    const value = parse(observationInputSchema, input);
    const supabase = await authorizedClient();
    const result = await rpc(supabase)("save_teacher_assessment_observation", {
      p_registration_id: value.registrationId,
      p_observation: value.observation,
    });
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ERROR_CODES);
  }
}

export async function completeTeacherAssessmentAction(
  registrationId: string,
): Promise<ActionResult<TeacherAssessmentSummary>> {
  try {
    const id = parse(uuid, registrationId);
    const supabase = await authorizedClient();
    const result = await rpc(supabase)("complete_teacher_assessment", {
      p_registration_id: id,
    });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: summaryFrom(result.data) };
  } catch (error) {
    return actionError<TeacherAssessmentSummary>(error, ERROR_CODES);
  }
}
