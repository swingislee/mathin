"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface CubeNetPlayback<T> {
  readonly durationMs: number;
  readonly sample: (elapsedMs: number) => T;
  readonly onFinish: () => void;
}

/** 教学动画的中间帧只作预览，完整播放后一次提交；取消回到播放前状态。 */
export function useCubeNetPlayback<T>({ essential = false }: { readonly essential?: boolean } = {}) {
  const [frame, setFrame] = useState<T | null>(null);
  const playback = useRef<{ frameId: number } | null>(null);
  const cancel = useCallback(() => {
    if (playback.current) cancelAnimationFrame(playback.current.frameId);
    playback.current = null;
    setFrame(null);
  }, []);
  const start = useCallback((job: CubeNetPlayback<T>) => {
    if (playback.current) cancelAnimationFrame(playback.current.frameId);
    // 主动教学演示需要呈现空间变化过程；普通装饰动效仍沿用系统偏好。
    if (job.durationMs <= 0 || (!essential && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      playback.current = null;
      setFrame(null);
      job.onFinish();
      return;
    }
    const active = { frameId: 0 };
    playback.current = active;
    setFrame(job.sample(0));
    let started: number | null = null;
    const tick = (now: number) => {
      if (playback.current !== active) return;
      started ??= now;
      const elapsed = Math.min(job.durationMs, now - started);
      if (elapsed === job.durationMs) {
        playback.current = null;
        setFrame(null);
        job.onFinish();
      } else {
        setFrame(job.sample(elapsed));
        active.frameId = requestAnimationFrame(tick);
      }
    };
    active.frameId = requestAnimationFrame(tick);
  }, [essential]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      if (playback.current) cancelAnimationFrame(playback.current.frameId);
      playback.current = null;
    };
  }, [cancel]);
  return { frame, playing: frame !== null, start, cancel };
}
