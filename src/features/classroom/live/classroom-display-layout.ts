export interface ClassroomDisplayPreferences {
  splitPercent: number | null;
  focusPercent: number | null;
}

export const DEFAULT_CLASSROOM_DISPLAY: ClassroomDisplayPreferences = { splitPercent: null, focusPercent: null };
export const CLASSROOM_DISPLAY_ASPECT = 4 / 3;
export const CLASSROOM_DISPLAY_SIDE_MIN = 256;
export const CLASSROOM_DISPLAY_GAP = 12;

export function parseClassroomDisplayPreferences(raw: string | null): ClassroomDisplayPreferences {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return DEFAULT_CLASSROOM_DISPLAY;
    const record = value as Record<string, unknown>;
    const percent = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate)
      && candidate >= 10 && candidate <= 100 ? candidate : null;
    return { splitPercent: percent(record.splitPercent), focusPercent: percent(record.focusPercent) };
  } catch {
    return DEFAULT_CLASSROOM_DISPLAY;
  }
}

/** 专注模式支持全宽放大；完整显示比例作为默认值，分栏继续保留右栏操作空间。 */
export function classroomDisplayBounds(width: number, height: number, focused: boolean) {
  const safeWidth = Number.isFinite(width) ? Math.max(1, width) : 1;
  const safeHeight = Number.isFinite(height) ? Math.max(1, height) : 1;
  const availableWidth = focused ? safeWidth : Math.max(1, safeWidth - CLASSROOM_DISPLAY_SIDE_MIN - CLASSROOM_DISPLAY_GAP);
  const fitWidth = Math.min(availableWidth, safeHeight * CLASSROOM_DISPLAY_ASPECT);
  const fitPercent = Math.max(1, Math.floor(fitWidth / safeWidth * 100));
  const maxWidth = focused ? availableWidth : fitWidth;
  const maxPercent = Math.max(1, Math.floor(maxWidth / safeWidth * 100));
  const minPercent = Math.max(1, Math.min(40, fitPercent - 10));
  return { minPercent, maxPercent, maxWidth, fitPercent };
}

/** 相对居中位置平移整块课件及板书：0 查看顶部，100 查看底部。 */
export function classroomFocusOffset(overflow: number, position: number) {
  const clamped = Number.isFinite(position) ? Math.max(0, Math.min(100, position)) : 50;
  return Math.max(0, overflow) * (0.5 - clamped / 100);
}

export function clampClassroomDisplayPercent(value: number, bounds: ReturnType<typeof classroomDisplayBounds>) {
  return Math.max(bounds.minPercent, Math.min(bounds.maxPercent, Number.isFinite(value) ? value : bounds.maxPercent));
}
