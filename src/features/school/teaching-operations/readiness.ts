import type { TeachingReadinessRow } from "../classes";

/**
 * "未发布/退回风险"（doc19 §13.5）：从未发布过、已退回、或已发布但有未发布草稿，三者任一都算风险。
 * 纯函数，不带 `server-only`——`ClassroomSettingsSheet`（client）与 `TeachingReadinessPanel`（server）都要用。
 */
export function hasTeachingReadinessRisk(row: TeachingReadinessRow): boolean {
  return !row.currentReleaseNo || row.workflowStage === "changes_requested" || row.hasUnpublishedChanges;
}
