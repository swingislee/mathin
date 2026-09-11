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

/** 视图工具固定在右下角，独立的 44px 学生按钮默认位于上方，间隔 32px。 */
export function classroomFocusToolsLayout(width: number, height: number) {
  const dockWidth = 52;
  const dockHeight = 100;
  const left = Math.max(0, width - dockWidth - 12);
  const top = Math.max(0, height - dockHeight - 80);
  const xRange = Math.max(0, width - 44);
  const yRange = Math.max(0, height - 80 - 44);
  const rosterLeft = Math.min(xRange, left + 4);
  const rosterTop = Math.max(0, Math.min(yRange, top - 76));
  return { left, top, width: dockWidth, height: dockHeight, hiddenOffset: width - left,
    rosterPosition: { x: rosterLeft / Math.max(1, xRange), y: rosterTop / Math.max(1, yRange) } };
}

export function classroomFocusRosterNearDock(width: number, height: number, position: { x: number; y: number }) {
  const target = classroomFocusToolsLayout(width, height).rosterPosition;
  return Math.hypot((position.x - target.x) * Math.max(0, width - 44),
    (position.y - target.y) * Math.max(0, height - 80 - 44)) <= 28;
}

export function classroomFocusToolsRosterLayout(width: number, height: number, count: number, position: { x: number; y: number }, docked: boolean) {
  const layout = classroomFocusDockLayout(width, height, count, position);
  if (!docked) return layout;
  const tools = classroomFocusToolsLayout(width, height);
  return { ...layout, left: Math.max(0, tools.left - 32 - layout.width),
    top: Math.max(0, layout.anchorTop + 44 - layout.height) };
}
