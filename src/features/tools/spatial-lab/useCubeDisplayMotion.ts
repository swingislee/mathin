"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CubeStructureState } from "./cube-structures-contract";
import { cubeDisplayPositions, cubeMotionDistance, cubeMotionDuration, cubePresentationState, interpolateCubePositions } from "./cube-structures-motion";

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useCubeDisplayMotion(state: CubeStructureState, sceneKey: object, onMovingChange: (moving: boolean) => void) {
  const reduced = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
  const target = useMemo(() => cubeDisplayPositions(state.cubes), [state.cubes]);
  const [frame, setFrame] = useState(() => ({ positions: target, sceneKey }));
  const current = useRef(frame);
  useEffect(() => {
    const from = current.current.positions;
    const distance = cubeMotionDistance(from, target);
    const snap = reduced || current.current.sceneKey !== sceneKey || distance === 0;
    onMovingChange(!snap);
    let frameId = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      const progress = snap ? 1 : Math.min(1, (now - start) / cubeMotionDuration(distance));
      const next = { positions: interpolateCubePositions(from, target, progress), sceneKey };
      current.current = next; setFrame(next);
      if (progress < 1) frameId = requestAnimationFrame(tick);
      else onMovingChange(false);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [target, reduced, sceneKey, onMovingChange]);
  const positions = reduced || frame.sceneKey !== sceneKey ? target : frame.positions;
  const moving = cubeMotionDistance(positions, target) > 0;
  const presentation = useMemo(() => cubePresentationState(state, positions), [state, positions]);
  return { presentation, moving };
}
