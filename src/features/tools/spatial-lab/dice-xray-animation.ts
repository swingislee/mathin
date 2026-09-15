import type { Group, Mesh } from "three";
import type { DiceXRayTarget } from "./dice-xray-observation";

export const DICE_XRAY_DURATION_MS = 900;
export interface DiceXRayMotion { readonly target: DiceXRayTarget | null; readonly progress: number }
export interface DiceXRayPresentation { readonly target: DiceXRayTarget | null; readonly phase: "closed" | "opening" | "open" | "closing" }

export function sameDiceXRayTarget(a: DiceXRayTarget | null, b: DiceXRayTarget | null) {
  return a?.id === b?.id && a?.face === b?.face;
}

/** 保留当前面直到恢复完成；新目标只取最新请求，不排队播放过期点击。 */
export function stepDiceXRayMotion(current: DiceXRayMotion, requested: DiceXRayTarget | null, elapsedMs: number): DiceXRayMotion {
  if (!current.target) return requested ? { target: requested, progress: 0 } : current;
  const step = Math.max(0, elapsedMs) / DICE_XRAY_DURATION_MS;
  if (sameDiceXRayTarget(current.target, requested)) return { target: current.target, progress: Math.min(1, current.progress + step) };
  const progress = Math.max(0, current.progress - step);
  return progress > 0 ? { target: current.target, progress } : { target: requested, progress: 0 };
}

export function diceXRayPresentation(motion: DiceXRayMotion, requested: DiceXRayTarget | null): DiceXRayPresentation {
  return { target: motion.target, phase: !motion.target ? "closed" : !sameDiceXRayTarget(motion.target, requested) ? "closing" : motion.progress < 1 ? "opening" : "open" };
}

const smooth = (value: number) => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };
/** 先退去遮挡点纹，再显现目标点纹；反向采样即为连续恢复。 */
export function diceXRayOpacity(progress: number, surfaceOpacity: number) {
  const window = smooth(progress / 0.6);
  return { window, face: smooth((progress - 0.6) / 0.4) * surfaceOpacity, outline: 0.95 * smooth(progress / 0.2), occluder: 0.22 * window };
}

/** 只更新本次透视覆盖层的材质，不改原骰子材质或 React 场景历史。 */
export function applyDiceXRayOpacity(root: Group, progress: number, surfaceOpacity: number) {
  const opacity = diceXRayOpacity(progress, surfaceOpacity);
  root.traverse((object) => {
    const material = (object as Mesh).material;
    if (!material || Array.isArray(material)) return;
    if (material.name === "dice-xray-window") material.opacity = opacity.window;
    if (material.name === "dice-xray-face") material.opacity = opacity.face;
    if (material.name === "dice-xray-outline") material.opacity = opacity.outline;
    if (material.name === "dice-xray-occluder") material.opacity = opacity.occluder;
  });
}
