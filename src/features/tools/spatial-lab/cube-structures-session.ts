import { CUBE_STRUCTURES_LIMITS, appendCubeOperation, applyCubeOperation, captureCubeOperation, createCubeHistory, replayCubeHistory, validateCubeSequence,
  type CubeHistory, type CubeOperation, type CubeSequenceIssue, type CubeStructureState } from "./cube-structures-contract";
import type { VoxelCoordinate } from "@/features/spatial-math/domain";

export interface CubeWorkbenchSession {
  readonly work: CubeHistory;
  readonly lesson: CubeHistory | null;
  readonly recording: "off" | "recording" | "paused";
  readonly preview: number | null;
}

export function createCubeSession(positions: readonly VoxelCoordinate[]): CubeWorkbenchSession {
  return { work: createCubeHistory(positions), lesson: null, recording: "off", preview: null };
}

export function cubeSnapshotHistory(state: CubeStructureState): CubeHistory {
  return { ...createCubeHistory([]), initial: state };
}

export function cubeSessionScene(session: CubeWorkbenchSession): CubeStructureState {
  return session.preview !== null && session.lesson ? replayCubeHistory(session.lesson, session.preview) : replayCubeHistory(session.work);
}

export function operateCubeSession(session: CubeWorkbenchSession, operation: CubeOperation): CubeWorkbenchSession {
  if (session.preview !== null) return session;
  if (session.recording === "recording" && session.lesson && session.lesson.cursor >= CUBE_STRUCTURES_LIMITS.steps) return session;
  const before = replayCubeHistory(session.work);
  const captured = captureCubeOperation(before, operation);
  if (applyCubeOperation(before, captured) === before) return session;
  // 自由操作保留最近 256 步撤销窗口；达到窗口上限仍可继续搭建。
  const base = session.work.cursor >= CUBE_STRUCTURES_LIMITS.steps ? {
    ...session.work, initial: replayCubeHistory(session.work, 1), operations: session.work.operations.slice(1), cursor: session.work.cursor - 1,
  } : session.work;
  const work = appendCubeOperation(base, captured);
  if (work === base) return session;
  return { ...session, work, lesson: session.recording === "recording" && session.lesson ? appendCubeOperation(session.lesson, captured) : session.lesson };
}

export function startCubeRecording(session: CubeWorkbenchSession): CubeWorkbenchSession {
  const snapshot = cubeSnapshotHistory(cubeSessionScene(session));
  return { ...session, work: snapshot, lesson: snapshot, recording: "recording", preview: null };
}

export function pauseCubeRecording(session: CubeWorkbenchSession): CubeWorkbenchSession {
  return session.recording === "recording" ? { ...session, recording: "paused" } : session;
}

export function finishCubeRecording(session: CubeWorkbenchSession): CubeWorkbenchSession {
  return { ...session, recording: "off", lesson: session.lesson ? { ...session.lesson, operations: session.lesson.operations.slice(0, session.lesson.cursor) } : null };
}

export function cubeResumeNeedsRestore(session: CubeWorkbenchSession): boolean {
  return Boolean(session.lesson && JSON.stringify(replayCubeHistory(session.work)) !== JSON.stringify(replayCubeHistory(session.lesson)));
}

/** 暂停期间可继续试操作；用户确认继续录制后恢复已录末步，避免未录动作破坏重放。 */
export function resumeCubeRecording(session: CubeWorkbenchSession): CubeWorkbenchSession {
  if (!session.lesson) return startCubeRecording(session);
  return { ...session, work: session.lesson, recording: "recording", preview: null };
}

export function undoCubeSession(session: CubeWorkbenchSession, delta: -1 | 1): CubeWorkbenchSession {
  if (session.preview !== null) return session;
  const workCursor = session.work.cursor + delta;
  if (workCursor < 0 || workCursor > session.work.operations.length) return session;
  if (session.recording === "recording" && session.lesson) {
    const lessonCursor = session.lesson.cursor + delta;
    if (lessonCursor < 0 || lessonCursor > session.lesson.operations.length) return session;
    return { ...session, work: { ...session.work, cursor: workCursor }, lesson: { ...session.lesson, cursor: lessonCursor } };
  }
  return { ...session, work: { ...session.work, cursor: workCursor } };
}

export function previewCubeSession(session: CubeWorkbenchSession, cursor: number | null): CubeWorkbenchSession {
  return { ...pauseCubeRecording(session), preview: cursor === null || !session.lesson ? null : Math.max(0, Math.min(cursor, session.lesson.operations.length)) };
}

export function createCubeDemo(prepared: CubeWorkbenchSession): CubeWorkbenchSession {
  const scene = prepared.lesson?.initial ?? replayCubeHistory(prepared.work);
  return { work: cubeSnapshotHistory(scene), lesson: prepared.lesson, recording: "off", preview: prepared.lesson ? 0 : null };
}

export function editCubeRecording(session: CubeWorkbenchSession, operations: readonly CubeOperation[]): { readonly session: CubeWorkbenchSession; readonly issue: CubeSequenceIssue | null } {
  if (!session.lesson) return { session, issue: null };
  const issue = validateCubeSequence(session.lesson.initial, operations);
  if (issue) return { session, issue };
  return { session: { ...session, recording: "off", lesson: { ...session.lesson, operations, cursor: operations.length },
    preview: Math.min(session.preview ?? operations.length, operations.length) }, issue: null };
}

export function moveCubeRecordedStep(session: CubeWorkbenchSession, from: number, to: number) {
  const operations = [...(session.lesson?.operations ?? [])];
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= operations.length || to >= operations.length) return { session, issue: null };
  const [operation] = operations.splice(from, 1);
  operations.splice(to, 0, operation);
  return editCubeRecording(session, operations);
}

export function replaceCubeRecordedStep(session: CubeWorkbenchSession, index: number, replacement: CubeOperation) {
  if (!session.lesson || !session.lesson.operations[index]) return { session, issue: null };
  const before = replayCubeHistory(session.lesson, index);
  const original = session.lesson.operations[index];
  let captured = captureCubeOperation(before, replacement);
  // 重录搭建或编组时保留身份，后续步骤继续引用原对象。
  if (original.kind === "build" && captured.kind === "build") captured = { ...captured, id: original.id };
  if (original.kind === "group" && captured.kind === "group") captured = { ...captured, id: original.id,
    color: replacement.kind === "group" ? replacement.color ?? original.color : captured.color };
  if (original.kind === "cut" && captured.kind === "cut") captured = { ...captured, groupId: original.groupId,
    color: replacement.kind === "cut" ? replacement.color ?? original.color : captured.color };
  if (applyCubeOperation(before, captured) === before) return { session, issue: { index, code: "invalid-operation" } as const };
  return editCubeRecording(session, session.lesson.operations.map((operation, cursor) => cursor === index ? captured : operation));
}
