export const LEARNING_CHECK_STATUSES = [
  "explained",
  "independent",
  "prompted",
  "imitated",
  "incomplete",
  "unchecked",
] as const;

export type LearningCheckStatus = (typeof LEARNING_CHECK_STATUSES)[number];

export const LEARNING_SEAT_COLUMNS = 4;
export const LEARNING_SEAT_ROWS = 5;
export const LEARNING_SEAT_CAPACITY = LEARNING_SEAT_COLUMNS * LEARNING_SEAT_ROWS;
export const LEARNING_SEAT_POSITION_LIMIT = 60;

export interface SessionLearningCheck {
  id: string;
  position: number;
  title: string;
  sourcePageId: string | null;
}

export interface SessionLearningStudent {
  id: string;
  name: string;
  seatPosition: number | null;
}

export type LearningSeatSlot = SessionLearningStudent | null;

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

export function buildLearningSeatSlots(
  students: SessionLearningSetup["students"],
  minimumCapacity = LEARNING_SEAT_CAPACITY,
): LearningSeatSlot[] {
  const highestSavedPosition = students.reduce(
    (highest, student) => Math.max(highest, student.seatPosition ?? -1),
    -1,
  );
  const requiredSlots = Math.max(minimumCapacity, students.length, highestSavedPosition + 1);
  const slotCount = Math.ceil(requiredSlots / LEARNING_SEAT_COLUMNS) * LEARNING_SEAT_COLUMNS;
  const slots: LearningSeatSlot[] = Array.from({ length: slotCount }, () => null);
  const unseated: SessionLearningStudent[] = [];

  for (const student of students) {
    const position = student.seatPosition;
    if (
      position !== null
      && position >= 0
      && position < slotCount
      && slots[position] === null
    ) {
      slots[position] = student;
    } else {
      unseated.push(student);
    }
  }

  for (const student of unseated) {
    const emptyPosition = slots.indexOf(null);
    if (emptyPosition < 0) break;
    slots[emptyPosition] = student;
  }
  return slots;
}

export function moveLearningStudentToSeat(
  slots: readonly LearningSeatSlot[],
  activeStudentId: string,
  targetPosition: number,
): LearningSeatSlot[] {
  const activePosition = slots.findIndex((student) => student?.id === activeStudentId);
  if (
    activePosition < 0
    || targetPosition < 0
    || targetPosition >= slots.length
    || activePosition === targetPosition
  ) return [...slots];
  const next = [...slots];
  [next[activePosition], next[targetPosition]] = [next[targetPosition], next[activePosition]];
  return next;
}

export function learningSeatAssignments(slots: readonly LearningSeatSlot[]): Array<{
  studentId: string;
  position: number;
}> {
  return slots.flatMap((student, position) => student
    ? [{ studentId: student.id, position }]
    : []);
}

export function learningResultKey(checkId: string, studentId: string): string {
  return checkId + ":" + studentId;
}

/** Students that still have no result for a check, excluding out-of-scope roster rows. */
export function learningUncheckedStudentIds(
  students: readonly SessionLearningStudent[],
  checkId: string,
  results: ReadonlyMap<string, LearningCheckStatus>,
  excludedStudentIds: ReadonlySet<string>,
): string[] {
  return students.flatMap((student) => (
    !excludedStudentIds.has(student.id)
    && (results.get(learningResultKey(checkId, student.id)) ?? "unchecked") === "unchecked"
      ? [student.id]
      : []
  ));
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
