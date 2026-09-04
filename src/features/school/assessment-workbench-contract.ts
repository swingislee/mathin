import type { ActivityRouteKind, AssessmentBand } from "./activity-workflow-contract";

export const ASSESSMENT_WORKBENCH_QUEUES = ["pending", "recorded", "all"] as const;

export type AssessmentWorkbenchQueue = (typeof ASSESSMENT_WORKBENCH_QUEUES)[number];

export interface AssessmentWorkbenchAssessment {
  id: string;
  assessmentBand: AssessmentBand | null;
  score: number | null;
  strengths: string;
  focusAreas: string;
  parentConcerns: string;
  teacherRecommendation: string;
  recommendedClass: string;
  updatedAt: string;
}
export interface AssessmentWorkbenchRoute {
  id: string;
  route: ActivityRouteKind;
  note: string;
  updatedAt: string;
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
  assessorName: string;
  background: string;
  participationStatus: "booked" | "attended" | "no_show" | "cancelled";
  assessment: AssessmentWorkbenchAssessment | null;
  route: AssessmentWorkbenchRoute | null;
  updatedAt: string;
}

export interface AssessmentWorkbenchFilters {
  queue: AssessmentWorkbenchQueue;
  q?: string;
}

export interface AssessmentWorkbenchCounts {
  pending: number;
  recorded: number;
  all: number;
}

export function assessmentWorkbenchQueueFrom(
  value: string | string[] | undefined,
): AssessmentWorkbenchQueue {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "recorded" || raw === "all" ? raw : "pending";
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
  const recorded = rows.filter((row) => row.assessment !== null).length;
  return {
    pending: rows.length - recorded,
    recorded,
    all: rows.length,
  };
}

export function assessmentWorkbenchRowsForView(
  rows: readonly AssessmentWorkbenchRow[],
  filters: AssessmentWorkbenchFilters,
  locale: string,
): AssessmentWorkbenchRow[] {
  const needle = filters.q?.toLocaleLowerCase(locale);
  return rows
    .filter((row) => {
      if (filters.queue === "pending" && row.assessment) return false;
      if (filters.queue === "recorded" && !row.assessment) return false;
      if (!needle) return true;
      return [row.name, row.phone, row.gradeText, row.location, row.assessorName, row.background]
        .some((value) => value.toLocaleLowerCase(locale).includes(needle));
    })
    .sort((left, right) => {
      if (filters.queue === "recorded") return right.updatedAt.localeCompare(left.updatedAt);
      return left.scheduledAt.localeCompare(right.scheduledAt) || left.name.localeCompare(right.name, locale);
    });
}
