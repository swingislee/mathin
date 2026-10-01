"use client";

import { useEffect, useRef, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";

export const MOTION_LONG_PRESS_MS = 500;
export const MOTION_DRAG_THRESHOLD = 3;

/** 点击、长按和拖动共用一次指针生命周期；移动、取消和失焦都会结束长按。 */
export function useMotionPress(onClick?: () => void, onLongPress?: () => void, disabled = false) {
  const stop = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (disabled) stop.current?.();
    return () => stop.current?.();
  }, [disabled]);

  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0 || event.isPrimary === false || stop.current) return;
      suppressClick.current = false;
      const { clientX, clientY, pointerId } = event;
      const timer = onLongPress ? window.setTimeout(() => {
        suppressClick.current = true;
        onLongPress();
      }, MOTION_LONG_PRESS_MS) : undefined;
      const move = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return;
        if (Math.hypot(next.clientX - clientX, next.clientY - clientY) > MOTION_DRAG_THRESHOLD) {
          suppressClick.current = true;
          window.clearTimeout(timer);
        }
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("blur", abort);
        stop.current = null;
      };
      const finish = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return;
        move(next);
        cleanup();
      };
      const abort = () => {
        suppressClick.current = true;
        cleanup();
      };
      const cancel = (next: PointerEvent) => {
        if (next.pointerId === pointerId) abort();
      };
      stop.current = abort;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("blur", abort);
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (disabled || (event.detail !== 0 && suppressClick.current)) {
        event.preventDefault();
        return;
      }
      onClick?.();
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
  };
}
