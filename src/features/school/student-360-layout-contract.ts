export const STUDENT_360_SPLIT_MIN_WIDTH = 960;
export const STUDENT_360_MAIN_MIN_WIDTH = 480;
export const STUDENT_360_SIDE_MIN_WIDTH = 320;
export const STUDENT_360_WIDTH_STORAGE_KEY = "mathin.student-360.width.v1";

/** 首次展开沿用原先 40%、416～736px 的默认宽度，拖拽后由用户分配空间。 */
export function defaultStudent360Width(workspaceWidth: number): number {
  return Math.min(736, Math.max(416, workspaceWidth * 0.4));
}

export function parseStudent360Width(stored: string | null): number | null {
  if (stored === null || stored.trim() === "") return null;
  const width = Number(stored);
  return Number.isFinite(width) && width >= STUDENT_360_SIDE_MIN_WIDTH ? width : null;
}
