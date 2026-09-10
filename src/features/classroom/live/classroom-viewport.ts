import type { SessionEvent } from "../types";

export const CLASSROOM_VIEWPORT_PROTOCOL = "mathin-classroom-viewport-v1";
export const CLASSROOM_VIEWPORT_REQUEST = "classroom-viewport-request";
export const CLASSROOM_VIEWPORT_RUNTIME_PARAM = "mathin_classroom_viewport";
export const CLASSROOM_VIEWPORT_RUNTIME_VERSION = "2";

/** 缩放以完整显示的 4:3 为基准，各屏幕按自身宽高换算；位置为课件中心。 */
export interface ClassroomViewport {
  focused: boolean;
  zoom: number;
  centerY: number;
}
export interface ClassroomViewportSnapshot extends ClassroomViewport {
  action: "viewport";
  version: 1;
  revision: number;
  writer: string;
}

export function parseClassroomViewport(value: unknown): ClassroomViewportSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).length !== 7 || p.action !== "viewport" || p.version !== 1
    || typeof p.focused !== "boolean" || typeof p.zoom !== "number" || !Number.isFinite(p.zoom) || p.zoom < 0.01 || p.zoom > 100
    || typeof p.centerY !== "number" || !Number.isFinite(p.centerY) || p.centerY < 0 || p.centerY > 1
    || typeof p.revision !== "number" || !Number.isSafeInteger(p.revision) || p.revision < 1
    || typeof p.writer !== "string" || !p.writer || p.writer.length > 128) return null;
  return p as unknown as ClassroomViewportSnapshot;
}

export function viewportEvent(event: SessionEvent): ClassroomViewportSnapshot | null {
  return event.type === "session_ctl" ? parseClassroomViewport(event.payload) : null;
}

export function compareViewport(a: ClassroomViewportSnapshot, b: ClassroomViewportSnapshot): number {
  return a.revision - b.revision || a.writer.localeCompare(b.writer);
}

export function viewportPosition(height: number, viewportHeight: number, centerY: number): number {
  const overflow = height - viewportHeight;
  return overflow > 0 ? Math.max(0, Math.min(100, (centerY * height - viewportHeight / 2) / overflow * 100)) : 50;
}

export function viewportCenter(height: number, viewportHeight: number, position: number): number {
  return height > viewportHeight ? (viewportHeight / 2 + (height - viewportHeight) * position / 100) / height : 0.5;
}

export interface ViewportTouch { x: number; y: number; clientY: number }
export interface ViewportGestureStart {
  distance: number;
  screenY: number;
  clientY: number;
  anchorY: number;
  percent: number;
}

export function beginViewportGesture(points: readonly ViewportTouch[], percent: number, rect: { top: number; height: number }): ViewportGestureStart {
  const [a, b] = points;
  const clientY = (a.clientY + b.clientY) / 2;
  return { distance: Math.max(8, Math.hypot(a.x - b.x, a.y - b.y)), screenY: (a.y + b.y) / 2, clientY,
    anchorY: (clientY - rect.top) / Math.max(1, rect.height), percent };
}

export function moveViewportGesture(start: ViewportGestureStart, points: readonly ViewportTouch[], viewport: { width: number; height: number; top: number }, min: number, max: number) {
  const [a, b] = points;
  const percent = Math.max(min, Math.min(max, start.percent * Math.hypot(a.x - b.x, a.y - b.y) / start.distance));
  const height = viewport.width * percent / 100 * 3 / 4;
  const top = start.clientY + (a.y + b.y) / 2 - start.screenY - start.anchorY * height;
  const centerY = Math.max(0, Math.min(1, (viewport.top + viewport.height / 2 - top) / Math.max(1, height)));
  return { percent, centerY };
}
