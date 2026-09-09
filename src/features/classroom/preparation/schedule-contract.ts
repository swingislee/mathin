export interface ClassroomScheduleWindow {
  scheduledAt: string | null;
  durationMin: number | null;
}

export function classroomScheduleBounds(window: ClassroomScheduleWindow) {
  const start = window.scheduledAt ? Date.parse(window.scheduledAt) : NaN;
  const duration = window.durationMin;
  if (!Number.isFinite(start) || duration === null || !Number.isFinite(duration) || duration <= 0) return null;
  const end = start + duration * 60_000;
  return Number.isFinite(end) ? { start, end } : null;
}

/** 在点击开课时判断；排课开始可开课，结束时起提示老师核对用途。 */
export function isOutsideClassroomSchedule(windows: readonly ClassroomScheduleWindow[], now: number): boolean {
  return !windows.some((window) => {
    const bounds = classroomScheduleBounds(window);
    return bounds !== null && now >= bounds.start && now < bounds.end;
  });
}

export function classroomRehearsalHref(pathname: string, search: string, kind: "session" | "activity") {
  const query = new URLSearchParams(search);
  query.set("entry", "prep");
  query.delete("role");
  if (kind === "activity") {
    query.set("rehearsal", "1");
    query.set("mode", "host");
  } else {
    query.set("mode", "rehearsal");
  }
  return `${pathname}?${query.toString()}`;
}
