"use client";
import { useEffect, useState } from "react";
import { animateSpatialAction } from "../spatial-interaction/policy";
import { placeValueProgress } from "./model";
import type { PlaceValueSnapshot } from "./contract";

/** 使用共用调度器和语义时间，回执及晚加入不会从头播放。 */
export function usePlaceValuePresentation(snapshot: PlaceValueSnapshot) {
  const [frame, setFrame] = useState({ id: "", progress: 1 });
  const motion = snapshot.motion;
  const timeline = motion ? [motion.id, motion.startedAt, motion.progress].join(":") : "";
  useEffect(() => {
    if (!motion || motion.paused) return;
    const remaining = Math.max(0, motion.durationMs * (1 - motion.progress) - (Date.now() - motion.startedAt));
    return animateSpatialAction(remaining, (elapsed) => setFrame({ id: timeline, progress: elapsed === 1 ? 1 : placeValueProgress(motion, Date.now()) }));
  }, [motion, timeline]);
  // 调度终帧明确落在 1，避免两套时钟的舍入差留下永久的“尚差一帧”。
  const progress = !motion ? 1 : motion.paused ? motion.progress : frame.id === timeline ? frame.progress : motion.progress;
  return { progress, busy: progress < 1, playing: progress < 1 && !motion?.paused };
}
