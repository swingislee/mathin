"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { getMyPerms } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVITY_ROUTES,
  STORED_ASSESSMENT_BANDS,
  type ActivityRouteKind,
  type StoredAssessmentBand,
} from "./activity-workflow-contract";
import { intInRange, parse, text, uuid } from "./actions/schemas";

const rowReferenceSchema = z.object({
  invitationId: uuid.nullable(),
  registrationId: uuid.nullable(),
}).refine((value) => Boolean(value.invitationId || value.registrationId), "ROW_REFERENCE_REQUIRED");

const assessmentInputSchema = rowReferenceSchema.and(z.object({
  assessmentBand: z.enum(STORED_ASSESSMENT_BANDS).nullable(),
  score: intInRange(0, 100).nullable(),
  strengths: text(2_000),
  focusAreas: text(2_000),
  parentConcerns: text(2_000),
  teacherRecommendation: text(2_000),
  recommendedClass: text(200),
}));

const routeInputSchema = rowReferenceSchema.and(z.object({
  route: z.enum(ACTIVITY_ROUTES),
  note: text(2_000),
}));

export interface AssessmentWorkbenchSaveInput {
  invitationId: string | null;
  registrationId: string | null;
  assessmentBand: StoredAssessmentBand | null;
  score: number | null;
  strengths: string;
  focusAreas: string;
  parentConcerns: string;
  teacherRecommendation: string;
  recommendedClass: string;
}

export interface AssessmentWorkbenchRouteInput {
  invitationId: string | null;
  registrationId: string | null;
  route: ActivityRouteKind;
  note: string;
}

interface AssessmentSaveResult {
  registrationId: string;
}

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

const ERROR_CODES = [
  "INVALID_ASSESSMENT",
  "INVALID_ACTIVITY_ROUTE",
  "INVITATION_NOT_CONFIRMED",
  "PARTICIPATION_NOT_ATTENDED",
  "PARTICIPATION_CANCELLED",
  "FORBIDDEN_SCOPE",
  "FORBIDDEN",
  "UNAUTHENTICATED",
  "NOT_FOUND",
];

function registrationIdFrom(data: unknown, fallback: string | null): string | null {
  if (fallback) return fallback;
  if (!data || typeof data !== "object" || !("registrationId" in data)) return null;
  const value = data.registrationId;
  return typeof value === "string" ? value : null;
}

export async function saveAssessmentWorkbenchRowAction(
  input: AssessmentWorkbenchSaveInput,
): Promise<ActionResult<AssessmentSaveResult>> {
  try {
    const value = parse(assessmentInputSchema, input);
    const supabase = await authorizedClient();
    const args = {
      p_assessment_band: value.assessmentBand ?? undefined,
      p_score: value.score ?? undefined,
      p_strengths: value.strengths,
      p_focus_areas: value.focusAreas,
      p_parent_concerns: value.parentConcerns,
      p_teacher_recommendation: value.teacherRecommendation,
      p_recommended_class: value.recommendedClass,
    };
    // Invitation-backed rows may still point at a Lead after the first save.
    // Keep using the invitation-aware RPC after materialization so later edits
    // do not fall back to the Student-only legacy activity writer.
    const result = value.invitationId
      ? await rpc(supabase)("save_invitation_assessment_row", {
          p_invitation_id: value.invitationId,
          ...args,
        })
      : await rpc(supabase)("save_activity_assessment_row", {
          p_registration_id: value.registrationId,
          ...args,
        });
    if (result.error) throw new Error(result.error.message);
    const registrationId = registrationIdFrom(result.data, value.registrationId);
    if (!registrationId) throw new Error("NOT_FOUND");
    return { ok: true, data: { registrationId } };
  } catch (error) {
    return actionError<AssessmentSaveResult>(error, ERROR_CODES);
  }
}

export async function saveAssessmentWorkbenchRouteAction(
  input: AssessmentWorkbenchRouteInput,
): Promise<ActionResult<AssessmentSaveResult>> {
  try {
    const value = parse(routeInputSchema, input);
    const supabase = await authorizedClient();
    const result = value.invitationId
      ? await rpc(supabase)("save_invitation_assessment_route", {
          p_invitation_id: value.invitationId,
          p_route: value.route,
          p_note: value.note,
        })
      : await rpc(supabase)("save_assessment_workbench_route", {
          p_registration_id: value.registrationId,
          p_route: value.route,
          p_note: value.note,
        });
    if (result.error) throw new Error(result.error.message);
    const registrationId = registrationIdFrom(result.data, value.registrationId);
    if (!registrationId) throw new Error("NOT_FOUND");
    return { ok: true, data: { registrationId } };
  } catch (error) {
    return actionError<AssessmentSaveResult>(error, ERROR_CODES);
  }
}
