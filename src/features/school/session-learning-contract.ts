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

export function moveLearningStudent(
  students: SessionLearningSetup["students"],
  activeStudentId: string,
  overStudentId: string,
): SessionLearningSetup["students"] {
  const activeIndex = students.findIndex((student) => student.id === activeStudentId);
  const overIndex = students.findIndex((student) => student.id === overStudentId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return students;
  const next = [...students];
  const [activeStudent] = next.splice(activeIndex, 1);
  next.splice(overIndex, 0, activeStudent);
  return next;
}

export function learningResultKey(checkId: string, studentId: string): string {
  return checkId + ":" + studentId;
}

/** Resolve the official page-bound check for the courseware page currently on air. */
export function learningCheckIdForPage(
  checks: readonly SessionLearningCheck[],
  pageDocId: string | null,
): string | null {
  if (!pageDocId) return null;
  return checks.find((check) => check.sourcePageId === pageDocId)?.id ?? null;
}

/**
 * Follow an on-air courseware page only when that page has an official check.
 * Unmarked/media/board pages keep the teacher's current check instead of
 * unexpectedly returning the panel to the first item.
 */
export function learningCheckIdAfterPageChange(
  checks: readonly SessionLearningCheck[],
  currentCheckId: string | null,
  pageDocId: string | null,
): string | null {
  const pageCheckId = learningCheckIdForPage(checks, pageDocId);
  if (pageCheckId) return pageCheckId;
  if (currentCheckId && checks.some((check) => check.id === currentCheckId)) return currentCheckId;
  return checks[0]?.id ?? null;
}
