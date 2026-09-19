"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animateSpatialAction, SPATIAL_ACTION_DURATION_MS, SPATIAL_REDUCED_ACTION_DURATION_MS } from "./policy";

/** 领域提供插值及稳定键；共用层负责连续帧、接续、回执去重与直接操作终点。 */
export function useSpatialPresentation<T>({ target, key, interpolate, instantKey, durationMs = SPATIAL_ACTION_DURATION_MS }: {
  target: T; key: string; interpolate: (from: T, to: T, progress: number) => T;
  instantKey?: string | null; durationMs?: number;
}) {
  const [frame, setFrame] = useState(() => ({ value: target, key }));
  const live = useRef(frame), latest = useRef(target);
  if (instantKey === key && frame.key !== key) setFrame({ value: target, key });
  useLayoutEffect(() => { latest.current = target; live.current = frame; }, [target, frame]);
  useEffect(() => {
    if (live.current.key === key) return;
    const from = live.current.value, to = latest.current;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    return animateSpatialAction(instantKey === key ? 0 : reduced ? SPATIAL_REDUCED_ACTION_DURATION_MS : durationMs, (progress) => {
      const value = progress === 1 ? to : interpolate(from, to, progress);
      const next = { value, key: progress === 1 ? key : "transition" };
      live.current = next; setFrame(next);
    });
  }, [key, instantKey, interpolate, durationMs]);
  return { value: instantKey === key ? target : frame.value, animating: instantKey !== key && frame.key !== key };
}
