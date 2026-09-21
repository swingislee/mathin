"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { animateSpatialAction, spatialActionProgress, SPATIAL_ACTION_DURATION_MS, SPATIAL_REDUCED_ACTION_DURATION_MS } from "../spatial-interaction/policy";
import type { DisplacementSnapshot } from "./displacement-contract";
import { displacementConfigurationKey } from "./displacement-math";

export function displacementPresentationKey(state: DisplacementSnapshot) { return `${displacementConfigurationKey(state)}:${state.body.bottom}`; }
export function interpolateDisplacement(from: DisplacementSnapshot, to: DisplacementSnapshot, progress: number): DisplacementSnapshot {
  if (displacementConfigurationKey(from) !== displacementConfigurationKey(to)) return to;
  const t = spatialActionProgress(progress);
  return { ...to, body: { ...to.body, bottom: from.body.bottom + (to.body.bottom - from.body.bottom) * t } };
}
/** 水位每帧从实际浸入体积求解；手拖终点已展示，课堂同一回执不会再次播放。 */
export function useDisplacementPresentation(target: DisplacementSnapshot, failed: boolean) {
  const key = displacementPresentationKey(target);
  const [display, setDisplay] = useState(() => ({ frame: target, key }));
  const live = useRef(target), direct = useRef<string | null>(null), current = useRef(target);
  useLayoutEffect(() => { current.current = target; }, [target]);
  useEffect(() => {
    if (failed && direct.current) {
      direct.current = null;
    } else if (direct.current) {
      if (direct.current === key) direct.current = null;
      return;
    }
    const next = current.current, from = live.current;
    if (displacementPresentationKey(from) === key) return;
    const duration = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? SPATIAL_REDUCED_ACTION_DURATION_MS : SPATIAL_ACTION_DURATION_MS;
    return animateSpatialAction(duration, (progress) => {
      const frame = interpolateDisplacement(from, next, progress);
      live.current = frame; setDisplay({ frame, key: progress === 1 ? key : "transition" });
    });
  }, [key, failed]);
  const preview = useCallback((frame: DisplacementSnapshot | null) => {
    if (!frame && direct.current) return;
    const next = frame ?? current.current;
    live.current = next; setDisplay({ frame: next, key: frame ? "drag" : displacementPresentationKey(next) });
  }, []);
  const acceptDirect = useCallback((next: DisplacementSnapshot) => {
    direct.current = displacementPresentationKey(next); live.current = next;
    setDisplay({ frame: next, key: direct.current });
  }, []);
  return { frame: display.frame, animating: display.key !== key && display.key !== "drag", preview, acceptDirect };
}
