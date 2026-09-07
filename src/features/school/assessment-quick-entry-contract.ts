import type { ActivityRouteKind, StoredAssessmentBand } from "./activity-workflow-contract";

export const REQUIRE_TEACHER_ASSESSMENT_FLAG = "assessment.require_teacher_completion";

export interface AssessmentQuickEntryValues {
  assessmentBand: StoredAssessmentBand | null;
  score: number | null;
  strengths: string;
  focusAreas: string;
  parentConcerns: string;
  teacherRecommendation: string;
  recommendedClass: string;
  route: ActivityRouteKind | null;
}

export interface AssessmentQuickEntry {
  id: string;
  values: AssessmentQuickEntryValues;
  revision: number;
  recordedBy: string;
  recordedByName: string;
  updatedAt: string;
  finalizedAt: string | null;
}

export interface AssessmentEntryActor {
  id: string;
  name: string;
  kind: "quick_entry" | "teacher";
  recordedAt: string;
}

export function hasQuickAssessmentResult(values: AssessmentQuickEntryValues): boolean {
  return values.score !== null || Boolean(values.assessmentBand)
    || [values.strengths, values.focusAreas, values.teacherRecommendation, values.recommendedClass].some((value) => value.trim());
}
