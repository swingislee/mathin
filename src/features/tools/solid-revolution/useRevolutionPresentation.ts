"use client";

import { useEffect, useState } from "react";
import { animateSpatialAction } from "../spatial-interaction/policy";
import type { SolidRevolutionSnapshot } from "./contract";
import { revolutionAngleAt, revolutionPlaying } from "./model";

/** 同一命令按绝对时间重建，晚加入和回执均不从零重播；课堂逐帧保持只读。 */
export function useRevolutionPresentation(snapshot: SolidRevolutionSnapshot) {
  const [clock, setClock] = useState(() => Date.now());
  const motion = snapshot.motion;
  useEffect(() => {
    if (!motion) return;
    const remaining = Math.max(0, motion.startedAt + motion.durationMs - Date.now());
    return animateSpatialAction(remaining, () => setClock(Date.now()));
  }, [motion?.id, motion?.startedAt, motion?.durationMs, motion]);
  // 旧帧时刻不能倒退到新命令之前；每个输入命令本身足以生成首帧。
  const now = Math.max(clock, motion?.startedAt ?? 0);
  return { angle: revolutionAngleAt(snapshot, now), playing: revolutionPlaying(snapshot, now) };
}
