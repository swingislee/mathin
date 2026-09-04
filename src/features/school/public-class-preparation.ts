import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { SessionPreparationArtifacts, PrepArtifactFile } from "./session-preparation-artifacts";
import {
  createLessonPlanTemplateV1,
  LESSON_PLAN_TEMPLATE_VERSION,
  type TeachingLessonPlan,
} from "./teacher-preparation-contract";

interface PublicClassPreparationRow {
  segment_id: string;
  solution_notes: string;
  solution_files: unknown;
  lesson_plan_files: unknown;
  rehearsal_video_url: string;
  lesson_plan_id: string;
  lesson_plan_template_version: string;
  lesson_plan_content: unknown;
  lesson_plan_revision: number;
  updated_at: string;
}

interface DbResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface Query<T> extends PromiseLike<DbResult<T>> {
  select(columns: string): Query<T>;
  in(column: string, values: readonly string[]): Query<T>;
}

type From = <T>(relation: string) => Query<T>;

function from<T>(client: { from: unknown }, relation: string): Query<T> {
  return (client.from as From)<T>(relation);
}

function files(value: unknown): PrepArtifactFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    return typeof row.path === "string"
      && typeof row.name === "string"
      && typeof row.size === "number"
      && typeof row.type === "string"
      ? [{ path: row.path, name: row.name, size: row.size, type: row.type }]
      : [];
  });
}

function emptyArtifacts(): SessionPreparationArtifacts {
  return {
    solutionNotes: "",
    solutionFiles: [],
    lessonPlanFiles: [],
    rehearsalVideoUrl: "",
    reviewerId: null,
    reviewerName: null,
    reviewerAssignmentSource: null,
    reviewerCandidates: [],
    reviews: {},
  };
}

function emptyLessonPlan(segmentId: string): TeachingLessonPlan {
  return {
    id: null,
    targetId: segmentId,
    templateVersion: LESSON_PLAN_TEMPLATE_VERSION,
    content: createLessonPlanTemplateV1(),
    status: "draft",
    revision: 0,
    updatedAt: null,
  };
}

export interface PublicClassPreparationData {
  artifacts: SessionPreparationArtifacts;
  lessonPlan: TeachingLessonPlan;
}

export async function getPublicClassPreparations(
  segmentIds: readonly string[],
): Promise<Record<string, PublicClassPreparationData>> {
  if (segmentIds.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await from<PublicClassPreparationRow[]>(
    supabase,
    "public_class_segment_preparations",
  )
    .select("segment_id,solution_notes,solution_files,lesson_plan_files,rehearsal_video_url,lesson_plan_id,lesson_plan_template_version,lesson_plan_content,lesson_plan_revision,updated_at")
    .in("segment_id", segmentIds);
  if (error) throw new Error(error.message);
  const rows = new Map((data ?? []).map((row) => [row.segment_id, row]));

  return Object.fromEntries(segmentIds.map((segmentId) => {
    const row = rows.get(segmentId);
    if (!row) return [segmentId, { artifacts: emptyArtifacts(), lessonPlan: emptyLessonPlan(segmentId) }];
    const revision = Math.max(0, row.lesson_plan_revision);
    return [segmentId, {
      artifacts: {
        ...emptyArtifacts(),
        solutionNotes: row.solution_notes,
        solutionFiles: files(row.solution_files),
        lessonPlanFiles: files(row.lesson_plan_files),
        rehearsalVideoUrl: row.rehearsal_video_url,
      },
      lessonPlan: {
        id: revision > 0 ? row.lesson_plan_id : null,
        targetId: segmentId,
        templateVersion: LESSON_PLAN_TEMPLATE_VERSION,
        content: Array.isArray(row.lesson_plan_content)
          ? row.lesson_plan_content
          : createLessonPlanTemplateV1(),
        status: "draft",
        revision,
        updatedAt: revision > 0 ? row.updated_at : null,
      },
    } satisfies PublicClassPreparationData];
  }));
}
