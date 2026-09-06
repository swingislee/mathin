import type { ActivityRouteKind, StoredAssessmentBand } from "./activity-workflow-contract";
import type { TeacherAssessmentOutcome } from "./teacher-assessment-contract";
import type { PublicClassPresence } from "./public-class";

export const ASSESSMENT_WORKBENCH_QUEUES = [
  "pending",
  "in_progress",
  "feedback",
  "handled",
  "all",
] as const;

export type AssessmentWorkbenchQueue = (typeof ASSESSMENT_WORKBENCH_QUEUES)[number];
export const ASSESSMENT_WORKBENCH_KINDS = ["one_to_one", "activity"] as const;
export type AssessmentWorkbenchKind = (typeof ASSESSMENT_WORKBENCH_KINDS)[number];

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

export interface AssessmentWorkbenchFollowUp {
  id: string;
  content: string;
  kind: string;
  createdAt: string;
  nextFollowUpAt: string | null;
  statusAfter: string | null;
}

export interface AssessmentWorkbenchPublicClassRecord {
  id: string | null;
  segmentId: string;
  segmentTitle: string;
  studentPresence: PublicClassPresence;
  guardianPresence: PublicClassPresence;
  learningObservation: string;
  assessmentSummary: string;
  parentFeedback: string;
  recommendation: string;
}

/** 学生测评总表的统一数据合同，覆盖单独预约和活动集中测评。 */
export interface AssessmentWorkbenchRow {
  id: string;
  recordState?: 'current' | 'historical';
  occurredOn?: string | null;
  assessmentKind: AssessmentWorkbenchKind;
  activityId: string | null;
  activityTitle: string;
  publicClassRecord: AssessmentWorkbenchPublicClassRecord | null;
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
  latestFollowUp?: AssessmentWorkbenchFollowUp | null;
  updatedAt: string;
}

export interface AssessmentWorkbenchFilters {
  queue: AssessmentWorkbenchQueue;
  kind?: AssessmentWorkbenchKind;
  q?: string;
}

export interface AssessmentWorkbenchCounts {
  pending: number;
  in_progress: number;
  feedback: number;
  handled: number;
  all: number;
  historical: number;
}

export function assessmentWorkbenchQueueFrom(
  value: string | string[] | undefined,
): AssessmentWorkbenchQueue {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "pending" || raw === "in_progress" || raw === "feedback" || raw === "handled"
    ? raw
    : "all";
}

export function parseAssessmentWorkbenchFilters(
  searchParams: Record<string, string | string[] | undefined>,
): AssessmentWorkbenchFilters {
  const qValue = Array.isArray(searchParams.q) ? searchParams.q[0] : searchParams.q;
  const kindValue = Array.isArray(searchParams.kind) ? searchParams.kind[0] : searchParams.kind;
  return {
    queue: assessmentWorkbenchQueueFrom(searchParams.queue),
    kind: kindValue === "one_to_one" || kindValue === "activity" ? kindValue : undefined,
    q: qValue?.trim().slice(0, 80) || undefined,
  };
}

export function assessmentWorkbenchCounts(
  rows: readonly AssessmentWorkbenchRow[],
): AssessmentWorkbenchCounts {
  const stages = rows.map(assessmentWorkbenchStage);
  return {
    pending: stages.filter((stage, i) => stage === "pending" && rows[i].recordState !== 'historical').length,
    in_progress: stages.filter((stage, i) => stage === "in_progress" && rows[i].recordState !== 'historical').length,
    feedback: stages.filter((stage, i) => stage === "feedback" && rows[i].recordState !== 'historical').length,
    handled: stages.filter((stage, i) => stage === "handled" && rows[i].recordState !== 'historical').length,
    all: rows.length,
    historical: rows.filter(row=>row.recordState==='historical').length,
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
      if (filters.queue !== 'all' && row.recordState === 'historical') return false;
      if (filters.kind && row.assessmentKind !== filters.kind) return false;
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

/** 可见名单中“保存并下一位”的稳定邻接关系。 */
export function nextAssessmentWorkbenchRowId(
  visibleRowIds: readonly string[],
  currentId: string,
): string | null {
  const index = visibleRowIds.indexOf(currentId);
  return index >= 0 && index + 1 < visibleRowIds.length ? visibleRowIds[index + 1] : null;
}
