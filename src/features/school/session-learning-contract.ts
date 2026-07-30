export const LEARNING_CHECK_STATUSES = [
  "explained",
  "independent",
  "prompted",
  "imitated",
  "incomplete",
  "unchecked",
] as const;

export type LearningCheckStatus = (typeof LEARNING_CHECK_STATUSES)[number];

export interface SessionLearningCheck {
  id: string;
  position: number;
  title: string;
  sourcePageId: string | null;
}

export interface SessionLearningStudent {
  id: string;
  name: string;
}

export interface SessionLearningResult {
  checkId: string;
  studentId: string;
  status: Exclude<LearningCheckStatus, "unchecked">;
}

export interface SessionLearningSetup {
  configured: boolean;
  checks: SessionLearningCheck[];
  students: SessionLearningStudent[];
  results: SessionLearningResult[];
}

export function learningResultKey(checkId: string, studentId: string): string {
  return checkId + ":" + studentId;
}
