import type { ActivityRouteKind, StoredAssessmentBand } from "./activity-workflow-contract";
import type { TeacherAssessmentOutcome } from "./teacher-assessment-contract";
import type { PublicClassPresence } from "./public-class";
import type { AssessmentEntryActor, AssessmentQuickEntry } from "./assessment-quick-entry-contract";
import type { AssessmentWorkflow } from "./assessment-workflow-contract";
import { hasSourceAssessmentConclusion } from './business-source-contract';
import type {SourceEnrollmentFacts} from './business-source-contract';
import type {SourceCompletionSummary} from './source-completion-contract';

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
  scoreMax?: number | null;
  strengths: string;
  focusAreas: string;
  parentConcerns: string;
  teacherRecommendation: string;
  recommendedClass: string;
  teacherObservation: string;
  updatedAt: string;
  resultSource?: "legacy" | "quick_entry" | "teacher";
  finalizedAt?: string | null;
  recordedByName?: string;
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
  paperVersionId?: string | null;
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
  enrollmentId?: string | null;
  paperVersionId?: string | null;
  sourceRecordId?: string | null;
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
  supportOwnerId?: string | null;
  supportOwnerName?: string;
  sourceEnrollmentFacts?: SourceEnrollmentFacts | null;
  sourceCompletion?: SourceCompletionSummary | null;
  background: string;
  participationStatus: "booked" | "attended" | "no_show" | "cancelled";
  assessmentStartedAt: string | null;
  assessmentCompletedAt: string | null;
  assessment: AssessmentWorkbenchAssessment | null;
  questionSummary: AssessmentWorkbenchQuestionSummary | null;
  route: AssessmentWorkbenchRoute | null;
  latestFollowUp?: AssessmentWorkbenchFollowUp | null;
  quickEntry?: AssessmentQuickEntry | null;
  entryActors?: AssessmentEntryActor[];
  teacherRequired?: boolean;
  workflow?: AssessmentWorkflow | null;
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
  const stages = rows.filter(row=>!assessmentAppointmentClosed(row)).map(assessmentWorkbenchStage);
  return {
    pending: stages.filter((stage) => stage === "pending").length,
    in_progress: stages.filter((stage) => stage === "in_progress").length,
    feedback: stages.filter((stage) => stage === "feedback").length,
    handled: stages.filter((stage) => stage === "handled").length,
    all: rows.length,
    historical: rows.filter(row=>row.recordState==='historical').length,
  };
}

export function assessmentWorkbenchStage(
  row: AssessmentWorkbenchRow,
): Exclude<AssessmentWorkbenchQueue, "all"> {
  if (row.workflow) return row.workflow.stage;
  if (assessmentWorkbenchHasFinalResult(row)) return row.route ? "handled" : "feedback";
  // 快速登记草稿和已完成归类各有事实，未发布分数不会被伪装成最终测评结果。
  if (row.route) return "handled";
  if (row.quickEntry || row.assessment?.resultSource === "teacher") return "in_progress";
  if (row.participationStatus === "attended" || row.assessmentStartedAt || row.assessment) return "in_progress";
  return "pending";
}

export function assessmentAppointmentClosed(row: Pick<AssessmentWorkbenchRow,'participationStatus'>): boolean {
  return row.participationStatus==='no_show'||row.participationStatus==='cancelled';
}

export function assessmentWorkbenchHasFinalResult(row: AssessmentWorkbenchRow): boolean {
  if(row.sourceRecordId&&['no_show','cancelled'].includes(row.participationStatus))return false;
  return Boolean(row.assessmentCompletedAt || row.assessment?.finalizedAt
    || (row.assessment && (!row.assessment.resultSource || row.assessment.resultSource === "legacy") && !row.assessmentStartedAt && (!row.sourceRecordId||hasSourceAssessmentConclusion(row.assessment))));
}

export function assessmentWorkbenchRowsForView(
  rows: readonly AssessmentWorkbenchRow[],
  filters: AssessmentWorkbenchFilters,
  locale: string,
): AssessmentWorkbenchRow[] {
  const needle = filters.q?.toLocaleLowerCase(locale);
  return rows
    .filter((row) => {
      if (filters.kind && row.assessmentKind !== filters.kind) return false;
      if (filters.queue !== "all" && (assessmentAppointmentClosed(row)||assessmentWorkbenchStage(row) !== filters.queue)) return false;
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
