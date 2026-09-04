import type { ActivityRouteKind, StoredAssessmentBand } from "./activity-workflow-contract";
import type { TeacherAssessmentOutcome } from "./teacher-assessment-contract";

export const ASSESSMENT_WORKBENCH_QUEUES = [
  "pending",
  "in_progress",
  "feedback",
  "handled",
  "all",
] as const;

export type AssessmentWorkbenchQueue = (typeof ASSESSMENT_WORKBENCH_QUEUES)[number];

export interface AssessmentWorkbenchAssessment {
  id: string;
  assessmentBand: StoredAssessmentBand | null;
  score: number | null;
  strengths: string;
  focusAreas: string;
  parentConcerns: string;
  teacherRecommendation: string;
  recommendedClass: string;
  teacherObservation: string;
  updatedAt: string;
}
export interface AssessmentWorkbenchRoute {
  id: string;
  route: ActivityRouteKind;
  note: string;
  updatedAt: string;
}

export interface AssessmentWorkbenchQuestionNote {
  questionNo: string;
  knowledgePoint: string;
  note: string;
}

export interface AssessmentWorkbenchQuestionSummary {
  paperTitle: string;
  answeredCount: number;
  questionCount: number;
  totalScore: number;
  outcomeCounts: Record<TeacherAssessmentOutcome, number>;
  keyNotes: AssessmentWorkbenchQuestionNote[];
}

/** Client-safe row for the cross-student 1:1 assessment work session. */
export interface AssessmentWorkbenchRow {
  id: string;
  invitationId: string | null;
  registrationId: string | null;
  studentId: string | null;
  leadId: string | null;
  name: string;
  phone: string;
  grade: number | null;
  gradeText: string;
  scheduledAt: string;
  location: string;
  assessorId: string | null;
  assessorName: string;
  assessorSource: "assigned" | "actual";
  background: string;
  participationStatus: "booked" | "attended" | "no_show" | "cancelled";
  assessmentStartedAt: string | null;
  assessmentCompletedAt: string | null;
  assessment: AssessmentWorkbenchAssessment | null;
  questionSummary: AssessmentWorkbenchQuestionSummary | null;
  route: AssessmentWorkbenchRoute | null;
  updatedAt: string;
}

export interface AssessmentWorkbenchFilters {
  queue: AssessmentWorkbenchQueue;
  q?: string;
}

export interface AssessmentWorkbenchCounts {
  pending: number;
  in_progress: number;
  feedback: number;
  handled: number;
  all: number;
}

export function assessmentWorkbenchQueueFrom(
  value: string | string[] | undefined,
): AssessmentWorkbenchQueue {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "in_progress" || raw === "feedback" || raw === "handled" || raw === "all"
    ? raw
    : "pending";
}

export function parseAssessmentWorkbenchFilters(
  searchParams: Record<string, string | string[] | undefined>,
): AssessmentWorkbenchFilters {
  const qValue = Array.isArray(searchParams.q) ? searchParams.q[0] : searchParams.q;
  return {
    queue: assessmentWorkbenchQueueFrom(searchParams.queue),
    q: qValue?.trim().slice(0, 80) || undefined,
  };
}

export function assessmentWorkbenchCounts(
  rows: readonly AssessmentWorkbenchRow[],
): AssessmentWorkbenchCounts {
  const stages = rows.map(assessmentWorkbenchStage);
  return {
    pending: stages.filter((stage) => stage === "pending").length,
    in_progress: stages.filter((stage) => stage === "in_progress").length,
    feedback: stages.filter((stage) => stage === "feedback").length,
    handled: stages.filter((stage) => stage === "handled").length,
    all: rows.length,
  };
}

export function assessmentWorkbenchStage(
  row: AssessmentWorkbenchRow,
): Exclude<AssessmentWorkbenchQueue, "all"> {
  if (row.assessmentCompletedAt) return row.route ? "handled" : "feedback";
  // Rows written by the retired aggregate editor predate per-question timestamps.
  // Treat those complete aggregate facts as historical completions, not active work.
  if (row.assessment && !row.assessmentStartedAt) return row.route ? "handled" : "feedback";
  if (row.assessmentStartedAt || row.assessment) return "in_progress";
  return "pending";
}

export function assessmentWorkbenchRowsForView(
  rows: readonly AssessmentWorkbenchRow[],
  filters: AssessmentWorkbenchFilters,
  locale: string,
): AssessmentWorkbenchRow[] {
  const needle = filters.q?.toLocaleLowerCase(locale);
  return rows
    .filter((row) => {
      if (filters.queue !== "all" && assessmentWorkbenchStage(row) !== filters.queue) return false;
      if (!needle) return true;
      return [row.name, row.phone, row.gradeText, row.location, row.assessorName, row.background]
        .some((value) => value.toLocaleLowerCase(locale).includes(needle));
    })
    .sort((left, right) => {
      if (filters.queue === "feedback" || filters.queue === "handled") {
        return right.updatedAt.localeCompare(left.updatedAt);
      }
      return left.scheduledAt.localeCompare(right.scheduledAt) || left.name.localeCompare(right.name, locale);
    });
}
