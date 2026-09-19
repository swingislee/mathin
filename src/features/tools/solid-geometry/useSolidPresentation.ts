"use client";

import { useEffect, useRef, useState } from "react";
import type { SolidEntity } from "./solid-geometry-contract";
import { interpolateSolidEntities, SOLID_TRANSITION_MS } from "./solid-geometry-motion";

export function solidEntitiesKey(entities: readonly SolidEntity[]) { return JSON.stringify(entities); }
/** 仅表现帧使用 rAF；共用课堂接口只接收离散终点。手动拖动终点无需重播。 */
export function useSolidPresentation(target: readonly SolidEntity[], instantKey: string | null) {
  const key = solidEntitiesKey(target);
  const [frame, setFrame] = useState({ entities: [...target], key });
  const live = useRef(frame.entities);
  useEffect(() => {
    const from = live.current, next = JSON.parse(key) as SolidEntity[];
    let request = 0; const started = performance.now();
    const duration = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 120 : SOLID_TRANSITION_MS;
    const step = (now: number) => { const progress = instantKey === key ? 1 : Math.min(1, (now - started) / duration);
      const entities = interpolateSolidEntities(from, next, progress); live.current = entities;
      setFrame({ entities, key: progress === 1 ? key : "transition" });
      if (progress < 1) request = requestAnimationFrame(step);
    };
    request = requestAnimationFrame(step); return () => cancelAnimationFrame(request);
  }, [key, instantKey]);
  return { entities: instantKey === key ? target : frame.entities, animating: instantKey !== key && frame.key !== key };
}
