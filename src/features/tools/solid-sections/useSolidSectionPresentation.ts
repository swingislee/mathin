"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SolidSectionSettings } from "./solid-sections-contract";
import { interpolateSolidSection, solidSectionFrame, SOLID_SECTION_TRANSITION_MS } from "./solid-sections-motion";

/** 权威快照只存终点；教师端和展示端从各自当前帧接续平面及移去一侧的透明动画。 */
export function useSolidSectionPresentation(settings: SolidSectionSettings, preview: SolidSectionSettings | null = null, instantKey: string | null = null) {
  const key = JSON.stringify(settings);
  const directKey = preview ? JSON.stringify(preview) : instantKey === key ? key : null;
  const [state, setState] = useState(() => ({ frame: solidSectionFrame(settings), key }));
  // 同步保留最后一个直接操作帧；取消或写入失败时从它退回，而不是先跳回旧帧再重播。
  if (directKey && state.key !== directKey) setState({ frame: solidSectionFrame(JSON.parse(directKey) as SolidSectionSettings), key: directKey });
  const live = useRef(state.frame);
  useLayoutEffect(() => { if (directKey) live.current = solidSectionFrame(JSON.parse(directKey) as SolidSectionSettings); }, [directKey]);
  useEffect(() => {
    if (directKey) return;
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
  }, [key, directKey]);
  return { frame: directKey ? solidSectionFrame(JSON.parse(directKey) as SolidSectionSettings) : state.frame, animating: !directKey && state.key !== key };
}
