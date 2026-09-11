import {
  learningCheckIdForPage,
  learningResultKey,
  type LearningCheckStatus,
  type SessionLearningSetup,
} from "./session-learning-contract";

export interface ClassroomLearningReminder {
  checkId: string;
  recorded: number;
  total: number;
  state: "pending" | "partial" | "saving" | "complete" | "empty";
}

/** 提醒只跟随当前页面；计数使用保存成功的记录，沿用缺席、请假的补登记排除口径。 */
export function classroomLearningReminder({
  checks, students, activePageDocId, savedResults, savingCellKeys,
  excludedStudentIds, attendanceSavingStudentIds,
}: Pick<SessionLearningSetup, "checks" | "students"> & {
  activePageDocId: string | null;
  savedResults: ReadonlyMap<string, LearningCheckStatus>;
  savingCellKeys: ReadonlySet<string>;
  excludedStudentIds: ReadonlySet<string>;
  attendanceSavingStudentIds: ReadonlySet<string>;
}): ClassroomLearningReminder | null {
  const checkId = learningCheckIdForPage(checks, activePageDocId);
  if (!checkId) return null;

  let recorded = 0;
  let total = 0;
  let saving = false;
  for (const student of students) {
    // 考勤还在保存时暂缓完成态，失败恢复考勤后重新计算。
    if (attendanceSavingStudentIds.has(student.id)) saving = true;
    if (excludedStudentIds.has(student.id)) continue;
    total += 1;
    const key = learningResultKey(checkId, student.id);
    const status = savedResults.get(key);
    if (status && status !== "unchecked") recorded += 1;
    if (savingCellKeys.has(key)) saving = true;
  }
  const state = saving ? "saving"
    : total === 0 ? "empty"
      : recorded === total ? "complete"
        : recorded > 0 ? "partial" : "pending";
  return { checkId, recorded, total, state };
}

export function applyLearningResultUpdates(
  results: ReadonlyMap<string, LearningCheckStatus>,
  cells: readonly { checkId: string; studentId: string }[],
  status: LearningCheckStatus,
): Map<string, LearningCheckStatus> {
  const next = new Map(results);
  for (const cell of cells) {
    const key = learningResultKey(cell.checkId, cell.studentId);
    if (status === "unchecked") next.delete(key);
    else next.set(key, status);
  }
  return next;
}
