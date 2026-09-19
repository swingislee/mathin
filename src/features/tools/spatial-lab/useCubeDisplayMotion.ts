"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CubeHistory, CubeStructureState } from "./cube-structures-contract";
import { cubeDisplayPositions, cubeMotionDistance, cubeMotionDuration, cubePresentationState, interpolateCubePositions, type CubeDisplayPositions } from "./cube-structures-motion";
import { cubeRotationAngle, cubeRotationMotion, cubeRotationPositions, type CubeRotationFrame } from "./cube-structures-rotation-motion";

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useCubeDisplayMotion(state: CubeStructureState, sceneKey: object, onMovingChange: (moving: boolean) => void, history?: CubeHistory) {
  const reduced = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
  const target = useMemo(() => cubeDisplayPositions(state.cubes), [state.cubes]);
  const [frame, setFrame] = useState<{ positions: CubeDisplayPositions; sceneKey: object; rotation: CubeRotationFrame | null;
    semantic: { state: CubeStructureState; history: CubeHistory | undefined } }>(() => ({ positions: target, sceneKey, rotation: null, semantic: { state, history } }));
  const [preview, setPreview] = useState<CubeDisplayPositions | null>(null);
  const current = useRef(frame);
  const semantic = useRef({ state, history });
  const previewPositions = useCallback((positions: CubeDisplayPositions | null) => {
    // 从指针事件同时更新可见帧与动画起点，松手后接续到吸附终点。
    if (positions) { const next = { positions, sceneKey, rotation: null, semantic: semantic.current }; current.current = next; setFrame(next); }
    setPreview(positions);
  }, [sceneKey]);
  useEffect(() => {
    if (preview) {
      onMovingChange(false);
      return;
    }
    const from = current.current.positions;
    const rotation = !reduced && current.current.sceneKey === sceneKey ? cubeRotationMotion(semantic.current.state, state, semantic.current.history, history) : null;
    semantic.current = { state, history };
    const distance = cubeMotionDistance(from, target);
    const snap = reduced || current.current.sceneKey !== sceneKey || (distance === 0 && !rotation);
    onMovingChange(!snap);
    let frameId = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      const progress = snap ? 1 : Math.min(1, (now - start) / (rotation ? 650 : cubeMotionDuration(distance)));
      const next = { positions: rotation ? cubeRotationPositions(rotation, target, progress) : interpolateCubePositions(from, target, progress), sceneKey, semantic: { state, history },
        rotation: rotation && progress < 1 ? { ...rotation, angle: cubeRotationAngle(rotation.operation.turn, progress) } : null };
      current.current = next; setFrame(next);
      if (progress < 1) frameId = requestAnimationFrame(tick);
      else onMovingChange(false);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [target, reduced, sceneKey, onMovingChange, preview, state, history]);
  const positions = preview ?? (reduced || frame.sceneKey !== sceneKey ? target : frame.positions);
  const pendingRotation = useMemo(() => frame.rotation ? null : cubeRotationMotion(frame.semantic.state, state, frame.semantic.history, history), [frame, state, history]);
  const rotation = !preview && !reduced && frame.sceneKey === sceneKey ? frame.rotation ?? (pendingRotation ? { ...pendingRotation, angle: 0 } : null) : null;
  const moving = !preview && (cubeMotionDistance(positions, target) > 0 || rotation !== null);
  const presentation = useMemo(() => cubePresentationState(state, positions), [state, positions]);
  return { presentation, moving, previewPositions, rotation };
}
