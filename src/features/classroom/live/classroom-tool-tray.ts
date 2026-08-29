export const CLASSROOM_TOOL_TRAY_SWIPE_THRESHOLD = 32;

export type ClassroomToolTrayGesture = "expand" | "collapse" | "none";

/**
 * Keep horizontal movement native to the scroll container. Only a clearly
 * vertical swipe changes the compact tool tray state.
 */
export function classifyClassroomToolTrayGesture(
  start: { x: number; y: number },
  end: { x: number; y: number },
): ClassroomToolTrayGesture {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) return "none";
  if (deltaY <= -CLASSROOM_TOOL_TRAY_SWIPE_THRESHOLD) return "expand";
  if (deltaY >= CLASSROOM_TOOL_TRAY_SWIPE_THRESHOLD) return "collapse";
  return "none";
}
