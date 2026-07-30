import "server-only";

import { createClient } from "@/lib/supabase/server";

export interface PrepArtifactFile {
  path: string;
  name: string;
  size: number;
  type: string;
}

export const PREP_ARTIFACT_KINDS = ["solution", "lesson_plan", "rehearsal_video"] as const;
export type PrepArtifactKind = (typeof PREP_ARTIFACT_KINDS)[number];
export type PrepArtifactReviewStatus = "pending" | "approved" | "changes_requested";

export interface PrepArtifactReview {
  kind: PrepArtifactKind;
  status: PrepArtifactReviewStatus;
  revision: number;
  submittedAt: string;
  reviewedAt: string | null;
  reviewNote: string;
}

export interface SessionPreparationArtifacts {
  solutionNotes: string;
  solutionFiles: PrepArtifactFile[];
  lessonPlanFiles: PrepArtifactFile[];
  rehearsalVideoUrl: string;
  reviews: Partial<Record<PrepArtifactKind, PrepArtifactReview>>;
}

function files(value: unknown): PrepArtifactFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    return typeof row.path === "string" && typeof row.name === "string"
      && typeof row.size === "number" && typeof row.type === "string"
      ? [{ path: row.path, name: row.name, size: row.size, type: row.type }]
      : [];
  });
}

export async function getSessionPreparationArtifacts(sessionId: string): Promise<SessionPreparationArtifacts> {
  const supabase = await createClient();
  const [{ data, error }, { data: reviewRows, error: reviewError }] = await Promise.all([
    supabase
      .from("session_preparation_artifacts")
      .select("solution_notes,solution_files,lesson_plan_files,rehearsal_video_url")
      .eq("session_id", sessionId)
      .maybeSingle<{
        solution_notes: string;
        solution_files: unknown;
        lesson_plan_files: unknown;
        rehearsal_video_url: string;
      }>(),
    supabase
      .from("session_preparation_reviews")
      .select("artifact_kind,status,revision,submitted_at,reviewed_at,review_note")
      .eq("session_id", sessionId)
      .returns<Array<{
        artifact_kind: PrepArtifactKind;
        status: PrepArtifactReviewStatus;
        revision: number;
        submitted_at: string;
        reviewed_at: string | null;
        review_note: string;
      }>>(),
  ]);
  if (error) throw new Error(error.message);
  if (reviewError) throw new Error(reviewError.message);
  const reviews = Object.fromEntries((reviewRows ?? []).map((row) => [row.artifact_kind, {
    kind: row.artifact_kind,
    status: row.status,
    revision: row.revision,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
  }])) as Partial<Record<PrepArtifactKind, PrepArtifactReview>>;
  return {
    solutionNotes: data?.solution_notes ?? "",
    solutionFiles: files(data?.solution_files),
    lessonPlanFiles: files(data?.lesson_plan_files),
    rehearsalVideoUrl: data?.rehearsal_video_url ?? "",
    reviews,
  };
}
