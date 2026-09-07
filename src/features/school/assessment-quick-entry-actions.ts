"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { getMyPerms } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ACTIVITY_ROUTES, STORED_ASSESSMENT_BANDS } from "./activity-workflow-contract";
import { intInRange, parse, text, uuid } from "./actions/schemas";
import type { AssessmentQuickEntry, AssessmentQuickEntryValues } from "./assessment-quick-entry-contract";
import type { AssessmentWorkbenchAssessment } from "./assessment-workbench-contract";

const valuesSchema = z.object({
  assessmentBand: z.enum(STORED_ASSESSMENT_BANDS).nullable(), score: intInRange(0, 10_000).nullable(),
  strengths: text(2000), focusAreas: text(2000), parentConcerns: text(2000),
  teacherRecommendation: text(2000), recommendedClass: text(200), route: z.enum(ACTIVITY_ROUTES).nullable(),
}).strict();
const inputSchema = z.object({
  registrationId: uuid.nullable(), invitationId: uuid.nullable(), values: valuesSchema,
  expectedRevision: z.number().int().nonnegative(),
}).strict().refine((value) => [value.registrationId, value.invitationId].filter(Boolean).length === 1);
const resultSchema = z.object({
  registrationId: uuid, activityId: uuid, recordedByName: z.string(), teacherRequired: z.boolean(),
  participationStatus: z.enum(["booked", "attended", "no_show", "cancelled"]),
  entry: z.object({ id: uuid, entry: valuesSchema, revision: z.number().int(), recorded_by: uuid, updated_at: z.string(), finalized_at: z.string().nullable() }),
  assessment: z.object({
    id: uuid, assessment_band: z.enum(STORED_ASSESSMENT_BANDS).nullable(), score: z.number().nullable(),
    strengths: z.string(), focus_areas: z.string(), parent_concerns: z.string(), teacher_recommendation: z.string(),
    recommended_class: z.string(), teacher_observation: z.string(), updated_at: z.string(),
    result_source: z.enum(["legacy", "quick_entry", "teacher"]), result_finalized_at: z.string().nullable(),
  }).nullable(),
});

export interface AssessmentQuickSaveResult {
  registrationId: string;
  activityId: string;
  quickEntry: AssessmentQuickEntry;
  assessment: AssessmentWorkbenchAssessment | null;
  teacherRequired: boolean;
  participationStatus: "booked" | "attended" | "no_show" | "cancelled";
}

export async function saveAssessmentQuickEntryAction(input: {
  registrationId: string | null; invitationId: string | null; values: AssessmentQuickEntryValues; expectedRevision: number;
}): Promise<ActionResult<AssessmentQuickSaveResult>> {
  try {
    const value = parse(inputSchema, input);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const perms = await getMyPerms(user.id);
    if (!perms.has("review.write") && !perms.has("followup.write")) throw new Error("FORBIDDEN");
    const { data, error } = await supabase.rpc("save_assessment_quick_entry", {
      p_registration_id: value.registrationId ?? undefined, p_invitation_id: value.invitationId ?? undefined,
      p_entry: value.values, p_expected_revision: value.expectedRevision,
    });
    if (error) throw new Error(error.message);
    const saved = resultSchema.parse(data);
    const assessment = saved.assessment;
    return { ok: true, data: {
      registrationId: saved.registrationId, activityId: saved.activityId, teacherRequired: saved.teacherRequired,
      participationStatus: saved.participationStatus,
      quickEntry: { id: saved.entry.id, values: saved.entry.entry, revision: saved.entry.revision,
        recordedBy: saved.entry.recorded_by, recordedByName: saved.recordedByName, updatedAt: saved.entry.updated_at, finalizedAt: saved.entry.finalized_at },
      assessment: assessment ? { id: assessment.id, assessmentBand: assessment.assessment_band, score: assessment.score,
        strengths: assessment.strengths, focusAreas: assessment.focus_areas, parentConcerns: assessment.parent_concerns,
        teacherRecommendation: assessment.teacher_recommendation, recommendedClass: assessment.recommended_class,
        teacherObservation: assessment.teacher_observation, updatedAt: assessment.updated_at,
        resultSource: assessment.result_source, finalizedAt: assessment.result_finalized_at } : null,
    } };
  } catch (error) {
    return actionError(error, ["ASSESSMENT_ENTRY_CONFLICT", "TEACHER_ASSESSMENT_REQUIRED", "PARTICIPATION_UNAVAILABLE",
      "INVITATION_NOT_CONFIRMED", "HISTORICAL_RECORD_READ_ONLY", "FORBIDDEN_SCOPE", "FORBIDDEN", "UNAUTHENTICATED", "VALIDATION"]);
  }
}
