import { classroomFocusDockLayout } from "./classroom-display-layout";

export interface ClassroomFocusToolsPreferences {
  x: number;
  y: number;
  docked: boolean;
  rosterOpen: boolean;
  hidden: boolean;
}

export function parseClassroomFocusToolsPreferences(raw: string | null): ClassroomFocusToolsPreferences {
  const defaults = { x: 1, y: 1, docked: true, rosterOpen: false, hidden: false };
  try {
    const value = JSON.parse(raw ?? "null");
    const coordinate = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.max(0, Math.min(1, candidate)) : 1;
    return { x: coordinate(value?.x), y: coordinate(value?.y), docked: value?.docked !== false,
      rosterOpen: value?.rosterOpen === true, hidden: value?.hidden === true };
  } catch { return defaults; }
}

/** 44px 图标入口停靠右下角；学生按钮使用相同坐标系，拖出后可贴到左右边缘。 */
export function classroomFocusToolsLayout(width: number, height: number, withRoster: boolean) {
  const dockWidth = 52;
  const dockHeight = withRoster ? 152 : 100;
  const left = Math.max(0, width - dockWidth - 12);
  const top = Math.max(0, height - dockHeight - 80);
  const xRange = Math.max(0, width - 44);
  const yRange = Math.max(0, height - 80 - 44);
  const rosterLeft = Math.min(xRange, left + 4);
  const rosterTop = Math.min(yRange, top + 104);
  return { left, top, width: dockWidth, height: dockHeight, hiddenOffset: width - left,
    rosterPosition: { x: rosterLeft / Math.max(1, xRange), y: rosterTop / Math.max(1, yRange) } };
}

export function classroomFocusRosterNearDock(width: number, height: number, position: { x: number; y: number }) {
  const target = classroomFocusToolsLayout(width, height, true).rosterPosition;
  return Math.hypot((position.x - target.x) * Math.max(0, width - 44),
    (position.y - target.y) * Math.max(0, height - 80 - 44)) <= 28;
}

export function classroomFocusToolsRosterLayout(width: number, height: number, count: number, position: { x: number; y: number }, docked: boolean) {
  const layout = classroomFocusDockLayout(width, height, count, position);
  if (!docked) return layout;
  const tools = classroomFocusToolsLayout(width, height, true);
  return { ...layout, left: Math.max(0, tools.left - 32 - layout.width),
    top: Math.max(0, layout.anchorTop + 44 - layout.height) };
}
