import type { CourseAssignment, CourseSeason, CoursewareWorkflowStage } from "@/features/school/teaching-operations/types";

export interface ActiveReviewCycleSummary {
  id: string;
  creatorId: string;
  creatorName: string;
  submittedAt: string;
  submissionNote: string;
}

export interface CoursewareTrackState {
  track: "native-16x9" | "adapted-4x3";
  stage: CoursewareWorkflowStage;
  currentReviewRound: number | null;
  requiredReviewRounds: number | null;
  internalDueAt: string | null;
  currentReleaseNo: number | null;
  hasUnpublishedChanges: boolean;
  activeReviewCycle: ActiveReviewCycleSummary | null;
}

/** resolve_course_assignments 就近继承解析出的有效责任人（doc19 §11："负责人：X / 来源：Y"）。 */
export interface EffectiveAssignment {
  responsibility: CourseAssignment["responsibility"];
  userId: string;
  userName: string;
  sourceScopeType: "family" | "variant" | "lecture";
  sourceLabel: string | null;
}

export interface LectureUsageItem {
  id: string;
  classroomId: string;
  classroomName: string;
  scheduledAt: string | null;
  endedAt: string | null;
}

/** cw_review_cycles 一行（一次提交/通过/退回/紧急发布事件），兼作校对历史与审计记录。 */
export interface ReviewCycleHistoryItem {
  id: string;
  track: "native-16x9" | "adapted-4x3";
  workflowCycleNo: number;
  reviewRoundNo: number;
  status: "submitted" | "changes_requested" | "passed" | "withdrawn" | "published" | "bypassed";
  creatorName: string;
  reviewerName: string | null;
  selfReview: boolean;
  submissionNote: string;
  submittedAt: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  publishedReleaseId: string | null;
}

export interface LectureWorkflowPolicy {
  requiredReviewRounds: number;
  allowCreatorAsReviewer: boolean;
  emergencyPublishEnabled: boolean;
}

export interface LectureWorkspaceDetail {
  policy: LectureWorkflowPolicy;
  lecture: {
    id: string;
    no: number;
    name: string;
    objectives: string;
    status: "draft" | "active" | "archived";
    archivedAt: string | null;
    pageCount: number;
  };
  family: { id: string; title: string };
  variant: { id: string; title: string; grade: number; courseSeason: CourseSeason; classType: string };
  tracks: CoursewareTrackState[];
  assignments: CourseAssignment[];
  effectiveAssignments: EffectiveAssignment[];
  usage: LectureUsageItem[];
  history: ReviewCycleHistoryItem[];
}
