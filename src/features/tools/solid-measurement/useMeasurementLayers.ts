"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MEASUREMENT_LAYER_MS } from "./measurement-contract";
import { measurementLayerFrame } from "./measurement-model";

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  media?.addEventListener?.("change", onChange);
  return () => media?.removeEventListener?.("change", onChange);
}
export function useMeasurementReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, () => false);
}

/** 晚加入直接还原确认后的层数；后续离散变化才逐层演示，中途改目标从当前帧继续。 */
export function useMeasurementLayers(target: number, identity: string): number {
  const [frame, setFrame] = useState({ identity, value: target });
  const live = useRef(frame);
  const reduced = useMeasurementReducedMotion();
  useEffect(() => {
    const from = live.current.identity === identity ? live.current.value : target;
    const started = performance.now();
    const perLayer = reduced ? 100 : MEASUREMENT_LAYER_MS;
    let request = 0;
    const step = (now: number) => {
      const value = measurementLayerFrame(from, target, now - started, perLayer);
      const next = { identity, value }; live.current = next; setFrame(next);
      if (value !== target) request = requestAnimationFrame(step);
    };
    request = requestAnimationFrame(step);
    return () => cancelAnimationFrame(request);
  }, [identity, target, reduced]);
  return frame.identity === identity ? frame.value : target;
}
