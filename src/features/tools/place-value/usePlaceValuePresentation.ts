"use client";
import { useEffect, useState } from "react";
import { animateSpatialAction } from "../spatial-interaction/policy";
import { placeValueProgress } from "./model";
import type { PlaceValueSnapshot } from "./contract";

/** 使用共用调度器和语义时间，回执及晚加入不会从头播放。 */
export function usePlaceValuePresentation(snapshot: PlaceValueSnapshot) {
  const [clock, setClock] = useState(() => Date.now());
  const motion = snapshot.motion;
  useEffect(() => {
    if (!motion || motion.paused) return;
    const remaining = Math.max(0, motion.durationMs * (1 - motion.progress) - (Date.now() - motion.startedAt));
    return animateSpatialAction(remaining, () => setClock(Date.now()));
  }, [motion]);
  const progress = placeValueProgress(motion, Math.max(clock, motion?.startedAt ?? 0));
  return { progress, busy: progress < 1, playing: progress < 1 && !motion?.paused };
}
