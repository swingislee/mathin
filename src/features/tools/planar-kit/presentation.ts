import { newId } from "@/lib/uuid";
import type { PlanarMotion, PlanarSnapshot, PlanarState } from "./contract";
import type { PlanarSceneDefinition } from "./types";

/** 仅由指针、按钮或 RAF 回调采样；渲染帧使用宿主保留的时间。 */
export const planarEventTime = () => Date.now();

export function planarProgress(motion: PlanarMotion, now: number): number {
  return Math.max(0, Math.min(1, motion.progress + (motion.paused ? 0 : (now - motion.startedAt) / motion.durationMs)));
}
export function interpolatePlanarState(from: PlanarState, to: PlanarState, progress: number): PlanarState {
  if (progress >= 1 || from.sceneId !== to.sceneId) return to;
  if (progress <= 0) return from;
  const lerp = (a: number, b: number) => a + (b - a) * progress;
  return { ...from, phase: lerp(from.phase, to.phase),
    params: Object.fromEntries(Object.entries(to.params).map(([key, value]) => [key, lerp(from.params[key] ?? value, value)])),
    points: Object.fromEntries(Object.entries(to.points).map(([key, point]) => [key, { x: lerp(from.points[key]?.x ?? point.x, point.x), y: lerp(from.points[key]?.y ?? point.y, point.y) }])),
  };
}
export function planarFrame(snapshot: PlanarSnapshot, definition: PlanarSceneDefinition, now: number) {
  if (!snapshot.motion) return snapshot.current;
  const motion = snapshot.motion, progress = planarProgress(motion, now);
  const action = definition.actions?.find((item) => item.id === motion.actionId);
  return (action?.interpolate ?? interpolatePlanarState)(motion.from, motion.to, progress);
}
export function planarCommit(snapshot: PlanarSnapshot, from: PlanarState, to: PlanarState, options?: { id: string; duration: number; now: number }): PlanarSnapshot {
  const unchanged = JSON.stringify(from) === JSON.stringify(to);
  return { current: to, past: unchanged ? snapshot.past : [...snapshot.past, from].slice(-12), future: unchanged ? snapshot.future : [],
    motion: options && options.duration > 0 && from.sceneId === to.sceneId ? {
      id: newId(), actionId: options.id, from, to, startedAt: options.now, durationMs: options.duration, progress: 0, paused: false,
    } : null };
}
export function planarHistory(snapshot: PlanarSnapshot, direction: "undo" | "redo"): PlanarSnapshot {
  const source = direction === "undo" ? snapshot.past : snapshot.future;
  const destination = source.at(-1);
  if (!destination) return snapshot;
  return { current: destination, motion: null,
    past: direction === "undo" ? snapshot.past.slice(0, -1) : [...snapshot.past, snapshot.current].slice(-12),
    future: direction === "redo" ? snapshot.future.slice(0, -1) : [...snapshot.future, snapshot.current].slice(-12) };
}
export function planarPause(snapshot: PlanarSnapshot, now: number, paused: boolean): PlanarSnapshot {
  if (!snapshot.motion) return snapshot;
  return { ...snapshot, motion: { ...snapshot.motion, progress: planarProgress(snapshot.motion, now), paused, startedAt: now } };
}
