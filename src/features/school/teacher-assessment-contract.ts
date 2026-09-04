import type { AssessmentBand, StoredAssessmentBand } from "./activity-workflow-contract";
import { LEARNING_CHECK_RATED_STATUSES } from "./session-learning-contract";

export const TEACHER_ASSESSMENT_OUTCOMES = LEARNING_CHECK_RATED_STATUSES;

export type TeacherAssessmentOutcome = (typeof TEACHER_ASSESSMENT_OUTCOMES)[number];

export interface TeacherAssessmentSummary {
  answeredCount: number;
  questionCount: number;
  score: number;
  totalScore: number;
  suggestedBand: AssessmentBand | null;
  completedAt?: string | null;
}

export interface TeacherAssessmentQuestionFillResult extends TeacherAssessmentSummary {
  questionIds: string[];
}

export interface TeacherAssessmentQuestionResult {
  outcome: TeacherAssessmentOutcome | null;
  score: number | null;
  note: string;
  updatedAt: string;
}

export interface TeacherAssessmentQuestion {
  id: string;
  position: number;
  questionNo: string;
  prompt: string;
  knowledgePoint: string;
  maxScore: number;
  quickScores: Record<TeacherAssessmentOutcome, number | null>;
  result: TeacherAssessmentQuestionResult | null;
}

export interface TeacherAssessmentPaperVersion {
  id: string;
  paperId: string;
  title: string;
  source: string;
  versionNo: number;
  questionCount: number;
  totalScore: number;
  bandThresholds: Record<AssessmentBand, number>;
}

export interface TeacherAssessmentPaperOption {
  id: string;
  paperId: string;
  title: string;
  source: string;
  versionNo: number;
  questionCount: number;
  totalScore: number;
}

export interface TeacherAssessmentWorkbenchData {
  registrationId: string;
  subjectName: string;
  grade: number | null;
  gradeText: string;
  background: string;
  participationStatus: "booked" | "attended" | "no_show" | "cancelled";
  scheduledAt: string;
  location: string;
  startedAt: string | null;
  completedAt: string | null;
  score: number | null;
  assessmentBand: StoredAssessmentBand | null;
  teacherObservation: string;
  paperVersion: TeacherAssessmentPaperVersion | null;
  questions: TeacherAssessmentQuestion[];
  paperOptions: TeacherAssessmentPaperOption[];
}

export function quickScoreForOutcome(
  question: TeacherAssessmentQuestion,
  outcome: TeacherAssessmentOutcome,
): number | null {
  return question.quickScores[outcome] ?? null;
}

export function teacherAssessmentSummary(
  paper: TeacherAssessmentPaperVersion,
  questions: readonly TeacherAssessmentQuestion[],
  completedAt?: string | null,
): TeacherAssessmentSummary {
  const answeredCount = questions.filter((question) => question.result?.outcome).length;
  const score = questions.reduce((total, question) => total + (question.result?.score ?? 0), 0);
  return {
    answeredCount,
    questionCount: paper.questionCount,
    score,
    totalScore: paper.totalScore,
    suggestedBand: assessmentBandForScore(score, paper.totalScore, paper.bandThresholds),
    completedAt,
  };
}

export function assessmentBandForScore(
  score: number,
  totalScore: number,
  thresholds: Record<AssessmentBand, number>,
): AssessmentBand | null {
  if (totalScore <= 0) return null;
  const percent = score * 100 / totalScore;
  if (percent >= thresholds.c) return "c";
  if (percent >= thresholds.s) return "s";
  if (percent >= thresholds.a_plus) return "a_plus";
  if (percent >= thresholds.a) return "a";
  if (percent >= thresholds.g_plus) return "g_plus";
  return "x_plus";
}
