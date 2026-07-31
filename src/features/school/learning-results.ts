import "server-only";

import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export const LEARNING_RESULT_KINDS = ["session_result", "video_review", "stage_report"] as const;
export type LearningResultKind = (typeof LEARNING_RESULT_KINDS)[number];

export const LEARNING_RESULT_STATUSES = ["draft", "review", "published", "withdrawn", "revised"] as const;
export type LearningResultStatus = (typeof LEARNING_RESULT_STATUSES)[number];

export interface StaffLearningResult {
  headId: string;
  kind: LearningResultKind;
  studentId: string;
  termId: string;
  sessionId: string | null;
  videoId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  status: LearningResultStatus;
  requiresReview: boolean;
  revisionId: string | null;
  revisionNo: number | null;
  content: Json | null;
  metricVersion: string | null;
  dataCutoffAt: string | null;
  timezone: string | null;
  dataset: Json | null;
  updatedAt: string;
}

function isLearningResultKind(value: string): value is LearningResultKind {
  return LEARNING_RESULT_KINDS.some((kind) => kind === value);
}

function isLearningResultStatus(value: string): value is LearningResultStatus {
  return LEARNING_RESULT_STATUSES.some((status) => status === value);
}

export async function listLearningResultsForStaff(input: {
  studentId?: string;
  kind?: LearningResultKind;
} = {}): Promise<StaffLearningResult[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_learning_results_for_staff", {
    ...(input.studentId ? { p_student_id: input.studentId } : {}),
    ...(input.kind ? { p_kind: input.kind } : {}),
  });
  if (error) throw new Error(error.message);

  return (data ?? []).flatMap((row) => {
    if (!isLearningResultKind(row.kind) || !isLearningResultStatus(row.status)) return [];
    return [{
      headId: row.head_id,
      kind: row.kind,
      studentId: row.student_id,
      termId: row.term_id,
      sessionId: row.session_id ?? null,
      videoId: row.video_id ?? null,
      periodStart: row.period_start ?? null,
      periodEnd: row.period_end ?? null,
      status: row.status,
      requiresReview: row.requires_review,
      revisionId: row.revision_id ?? null,
      revisionNo: row.revision_no ?? null,
      content: row.content ?? null,
      metricVersion: row.metric_version ?? null,
      dataCutoffAt: row.data_cutoff_at ?? null,
      timezone: row.timezone ?? null,
      dataset: row.dataset ?? null,
      updatedAt: row.updated_at,
    }];
  });
}
