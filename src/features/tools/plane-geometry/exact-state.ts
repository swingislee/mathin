import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { unwrapAngle } from "../plane-motion/model";

// 越过一天边界的指针角只留在手势预览上下文，持久分钟数仍在原范围内。
const clockPreviewAngles = new WeakMap<PlanarState, { start: PlanarState; target: string; angle: number }>();

/** 旧存档仍可读取投影参数；准确停点只接受七片各自未压扁的刚性朝向。 */
export function isExactTangramState(state: PlanarState): boolean {
  return state.sceneId === "02" && Array.from({ length: 7 }, (_, index) => state.params[`reflection${index}`])
    .every((reflection) => reflection === 1 || reflection === -1);
}

/** 起拖点保留握持偏差；上一预览只用于跨圈展开，两针始终由同一个分钟数联动。 */
export function dragClockState(start: PlanarState, target: string, point: PlanarPoint, delta: PlanarPoint, previous?: PlanarState): PlanarState {
  if (start.sceneId !== "60" || !["minute", "hour"].includes(target)
    || ![point.x, point.y, delta.x, delta.y].every(Number.isFinite)) return start;
  const reference = previous?.sceneId === start.sceneId && Number.isFinite(previous.params.minutes) ? previous : start;
  const origin = { x: point.x - delta.x - 480, y: point.y - delta.y - 350 }, current = { x: point.x - 480, y: point.y - 350 };
  // 圆心处没有可定义的针方向，经过它时保持上一合法预览。
  if (Math.hypot(origin.x, origin.y) < 1e-8 || Math.hypot(current.x, current.y) < 1e-8) return reference;
  const speed = target === "minute" ? 6 : 0.5;
  const turn = (Math.atan2(current.y, current.x) - Math.atan2(origin.y, origin.x)) * 180 / Math.PI;
  const preview = clockPreviewAngles.get(reference);
  const previousAngle = preview?.start === start && preview.target === target ? preview.angle : reference.params.minutes * speed;
  const angle = unwrapAngle(start.params.minutes * speed + turn, previousAngle);
  const minutes = Math.max(0, Math.min(1440, angle / speed));
  if (Math.abs(angle / speed - start.params.minutes) < 1e-10) return start;
  const next = { ...start, params: { ...start.params, minutes } };
  clockPreviewAngles.set(next, { start, target, angle });
  return next;
}
