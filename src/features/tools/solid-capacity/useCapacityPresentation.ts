"use client";

import { useEffect, useRef, useState } from "react";
import type { SolidCapacitySnapshot } from "./solid-capacity-contract";
import { CAPACITY_TRANSITION_MS, capacityPresentation, interpolateCapacity, type CapacityPresentation } from "./solid-capacity-motion";

/** 只对已接受的 snapshot 插值；教师回执相同终点不会再播放一遍。 */
export function useCapacityPresentation(target: SolidCapacitySnapshot) {
  const key = JSON.stringify(capacityPresentation(target));
  const [display, setDisplay] = useState(() => ({ frame: capacityPresentation(target), key }));
  const live = useRef(display.frame);
  useEffect(() => {
    const next = JSON.parse(key) as CapacityPresentation, from = live.current;
    if (JSON.stringify(from) === key) return;
    const started = performance.now(); let request = 0;
    const duration = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 180 : CAPACITY_TRANSITION_MS;
    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - started) / duration));
      const frame = progress === 1 ? next : interpolateCapacity(from, next, progress);
      live.current = frame; setDisplay({ frame, key: progress === 1 ? key : "transition" });
      if (progress < 1) request = requestAnimationFrame(step);
    };
    request = requestAnimationFrame(step); return () => cancelAnimationFrame(request);
  }, [key]);
  return { frame: display.frame, animating: display.key !== key };
}
