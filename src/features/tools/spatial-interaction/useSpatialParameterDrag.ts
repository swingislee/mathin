"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { beginSpatialObjectGesture } from "@/features/spatial-math/renderer-r3f/spatial-object-gesture";
import { parameterAlongTrajectory, type ParameterPoint } from "./parameter-trajectory";

/** 曲面卷展等非刚体参数共用指针会话。刚体仍走 object-gesture-controller。 */
export function useSpatialParameterDrag<K>({ enabled, onPreview, onCommit, onDragging }: {
  enabled: boolean; onPreview: (key: K, value: number | null) => void; onCommit: (key: K, value: number) => void; onDragging: (active: boolean) => void;
}) {
  const canvas = useThree((s) => s.gl.domElement), get = useThree((s) => s.get);
  const callbacks = useRef({ onPreview, onCommit, onDragging });
  useLayoutEffect(() => { callbacks.current = { onPreview, onCommit, onDragging }; });
  const drag = useRef<{ key: K; id: number; value: number; start: number; point: ParameterPoint; origin: ParameterPoint; project: (v: number) => ParameterPoint; moved: boolean; controls?: { enabled: boolean }; wasEnabled: boolean } | null>(null);
  const finish = useCallback((cancel: boolean) => {
    const current = drag.current; if (!current) return; drag.current = null;
    if (current.controls) current.controls.enabled = current.wasEnabled;
    try {
      if (canvas.hasPointerCapture(current.id)) canvas.releasePointerCapture(current.id);
      if (cancel || !current.moved) callbacks.current.onPreview(current.key, null);
      else callbacks.current.onCommit(current.key, current.value);
    } finally { callbacks.current.onDragging(false); }
  }, [canvas]);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current; if (!d || d.id !== e.pointerId) return;
      e.preventDefault(); e.stopPropagation();
      if (!d.moved && Math.hypot(e.clientX - d.point.x, e.clientY - d.point.y) < 3) return;
      d.moved = true;
      d.value = parameterAlongTrajectory(d.project, { x: d.origin.x + e.clientX - d.point.x, y: d.origin.y + e.clientY - d.point.y }, d.value);
      callbacks.current.onPreview(d.key, d.value);
    };
    const up = (e: PointerEvent) => { if (drag.current?.id === e.pointerId) { move(e); finish(false); } };
    const cancel = () => finish(true), pointerCancel = (e: PointerEvent) => { if (drag.current?.id === e.pointerId) cancel(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    const second = (e: PointerEvent) => { if (drag.current && drag.current.id !== e.pointerId) cancel(); };
    canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", pointerCancel); canvas.addEventListener("lostpointercapture", pointerCancel); canvas.addEventListener("pointerdown", second, true);
    window.addEventListener("blur", cancel); window.addEventListener("keydown", key);
    return () => { canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", pointerCancel); canvas.removeEventListener("lostpointercapture", pointerCancel); canvas.removeEventListener("pointerdown", second, true);
      window.removeEventListener("blur", cancel); window.removeEventListener("keydown", key); finish(true); };
  }, [canvas, finish]);
  useEffect(() => { if (!enabled) finish(true); }, [enabled, finish]);
  return (key: K, event: { button: number; isPrimary: boolean; pointerId: number; clientX: number; clientY: number; stopPropagation: () => void }, initial: number, project: (v: number) => ParameterPoint) => {
    if (!enabled || event.button !== 0 || event.isPrimary === false || drag.current) return;
    event.stopPropagation(); beginSpatialObjectGesture(canvas);
    const controls = get().controls as unknown as { enabled: boolean } | undefined;
    drag.current = { key, id: event.pointerId, value: initial, start: initial, point: { x: event.clientX, y: event.clientY }, origin: project(initial), project, moved: false, controls, wasEnabled: controls?.enabled ?? false };
    if (controls) controls.enabled = false;
    canvas.setPointerCapture(event.pointerId); callbacks.current.onDragging(true);
  };
}
