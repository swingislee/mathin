import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { STORED_ASSESSMENT_BANDS } from "./activity-workflow-contract";
import {
  TEACHER_ASSESSMENT_OUTCOMES,
  type TeacherAssessmentWorkbenchData,
} from "./teacher-assessment-contract";

type UntypedRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return (supabase.rpc as UntypedRpc).bind(supabase);
}

const thresholdsSchema = z.object({
  x_plus: z.number(),
  g_plus: z.number(),
  a: z.number(),
  a_plus: z.number(),
  s: z.number(),
  c: z.number(),
});

const quickScoresSchema = z.object({
  independent: z.number().nullable(),
  prompted: z.number().nullable(),
  partial: z.number().nullable(),
  unable: z.number().nullable(),
  not_tested: z.number().nullable(),
});

const paperOptionSchema = z.object({
  id: z.string().uuid(),
  paperId: z.string().uuid(),
  title: z.string(),
  source: z.string(),
  versionNo: z.number().int(),
  questionCount: z.number().int(),
  totalScore: z.number().int(),
});

const teacherAssessmentDataSchema = z.object({
  registrationId: z.string().uuid(),
  subjectName: z.string(),
  grade: z.number().int().nullable(),
  gradeText: z.string(),
  background: z.string(),
  participationStatus: z.enum(["booked", "attended", "no_show", "cancelled"]),
  scheduledAt: z.string(),
  location: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  score: z.number().nullable(),
  assessmentBand: z.enum(STORED_ASSESSMENT_BANDS).nullable(),
  teacherObservation: z.string(),
  paperVersion: paperOptionSchema.extend({ bandThresholds: thresholdsSchema }).nullable(),
  questions: z.array(z.object({
    id: z.string().uuid(),
    position: z.number().int(),
    questionNo: z.string(),
    prompt: z.string(),
    knowledgePoint: z.string(),
    maxScore: z.number().int(),
    quickScores: quickScoresSchema,
    result: z.object({
      outcome: z.enum(TEACHER_ASSESSMENT_OUTCOMES).nullable(),
      score: z.number().int().nullable(),
      note: z.string(),
      updatedAt: z.string(),
    }).nullable(),
  })),
  paperOptions: z.array(paperOptionSchema),
});

export async function getTeacherAssessmentWorkbenchData(
  registrationId: string,
): Promise<TeacherAssessmentWorkbenchData> {
  const supabase = await createClient();
  const result = await rpc(supabase)("get_teacher_assessment_workbench", {
    p_registration_id: registrationId,
  });
  if (result.error) throw new Error(result.error.message);
  return teacherAssessmentDataSchema.parse(result.data);
}
