/** 缺数保持未知，超额完成保留真实比例，图形宽度单独限制在轨道内。 */
export function overviewTargetProgress(actual: number | null, target: number | null) {
  if (actual === null || target === null || !Number.isFinite(actual) || !Number.isFinite(target) || actual < 0 || target <= 0) return null;
  const percent = actual / target * 100;
  return { percent, width: Math.min(100, percent), remaining: Math.max(0, target - actual), exceeded: Math.max(0, actual - target) };
}

export interface OverviewClassroomOccupancy {
  id: string;
  name: string;
  grade: number | null;
  teacherNames: string[];
  enrolledSeats: number | null;
  minimumOpen: number;
  healthy: number | null;
  full: number | null;
}
