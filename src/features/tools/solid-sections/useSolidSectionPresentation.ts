"use client";

import { useEffect, useRef, useState } from "react";
import type { SolidSectionSettings } from "./solid-sections-contract";
import { interpolateSolidSection, solidSectionFrame, SOLID_SECTION_TRANSITION_MS } from "./solid-sections-motion";

/** 权威快照只存终点；教师端和展示端从各自当前帧接续平面及移去一侧的透明动画。 */
export function useSolidSectionPresentation(settings: SolidSectionSettings) {
  const key = JSON.stringify(settings);
  const [state, setState] = useState(() => ({ frame: solidSectionFrame(settings), key }));
  const live = useRef(state.frame);
  useEffect(() => {
    const from = live.current, to = solidSectionFrame(JSON.parse(key) as SolidSectionSettings), started = performance.now();
    const duration = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 120 : SOLID_SECTION_TRANSITION_MS;
    let request = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration), frame = interpolateSolidSection(from, to, progress);
      live.current = frame; setState({ frame, key: progress === 1 ? key : "transition" });
      if (progress < 1) request = requestAnimationFrame(step);
    };
    request = requestAnimationFrame(step);
    return () => cancelAnimationFrame(request);
  }, [key]);
  return { frame: state.frame, animating: state.key !== key };
}
