export type ClassroomRunMode = "formal" | "rehearsal" | "offline-drill";
export type ClassroomRunState = "scheduled" | "started" | "ended";
export type ClassroomEntry = "prep" | "live" | null;

export function parseClassroomEntry(value: unknown): ClassroomEntry {
  return value === "prep" || value === "live" ? value : null;
}

export function initialClassroomView({
  mode,
  runState,
  entry,
}: {
  mode: ClassroomRunMode;
  runState: ClassroomRunState;
  entry: ClassroomEntry;
}): "prep" | "live" {
  if (entry === "prep" || mode === "rehearsal") return "prep";
  return runState === "scheduled" ? "prep" : "live";
}

export function preparationAction(mode: ClassroomRunMode, runState: ClassroomRunState) {
  if (mode === "rehearsal") return "rehearse";
  if (mode === "offline-drill") return "drill";
  if (runState === "ended") return "review";
  return runState === "started" ? "resume" : "start";
}

/** 只有正式课的首次开始执行领域写入；返回课堂与演练只改变当前设备的视图。 */
export async function enterFromPreparation({
  mode,
  runState,
  canEnter,
  startFormal,
  enterStage,
}: {
  mode: ClassroomRunMode;
  runState: ClassroomRunState;
  canEnter: boolean;
  startFormal: () => Promise<void>;
  enterStage: () => void;
}) {
  if (!canEnter) return;
  if (preparationAction(mode, runState) === "start") await startFormal();
  enterStage();
}

/** 展示预览保留原模式，试讲窗口始终与正式课堂隔离。 */
export function classroomDisplayHref(pathname: string, search: string): string {
  const query = new URLSearchParams(search);
  query.set("role", "display");
  query.delete("entry");
  return `${pathname}?${query.toString()}`;
}
