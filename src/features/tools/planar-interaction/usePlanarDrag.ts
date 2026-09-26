"use client";

import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { planePointFromClient, type PlaneMatrix, type PlanePoint } from "./geometry";

export interface PlanarDragFrame<T> { data: T; point: PlanePoint; delta: PlanePoint; moved: boolean }

/** 本体与专用手柄复用同一指针捕获、坐标变换和取消合同。 */
export function usePlanarDrag<T>(svg: RefObject<SVGSVGElement | null>, callbacks: {
  onMove: (frame: PlanarDragFrame<T>) => void;
  onFinish: (frame: PlanarDragFrame<T>) => void;
  onCancel: (data: T) => void;
}) {
  const active = useRef<{ data: T; pointerId: number; start: PlanePoint; clientStart: PlanePoint; moved: boolean; matrix: PlaneMatrix } | null>(null);
  const frame = (event: ReactPointerEvent): PlanarDragFrame<T> | null => {
    const drag = active.current;
    if (!drag || drag.pointerId !== event.pointerId) return null;
    drag.moved ||= Math.hypot(event.clientX - drag.clientStart.x, event.clientY - drag.clientStart.y) > 3;
    const point = planePointFromClient({ x: event.clientX, y: event.clientY }, drag.matrix);
    return point ? { data: drag.data, point, delta: { x: point.x - drag.start.x, y: point.y - drag.start.y }, moved: drag.moved } : null;
  };
  const release = () => {
    const drag = active.current;
    active.current = null;
    if (drag && svg.current?.hasPointerCapture(drag.pointerId)) svg.current.releasePointerCapture(drag.pointerId);
    return drag;
  };
  const cancel = () => { const drag = release(); if (drag) callbacks.onCancel(drag.data); };
  return {
    cancel,
    start(event: ReactPointerEvent, data: T) {
      if (active.current || event.button !== 0 || !event.isPrimary) return false;
      const matrix = svg.current?.getScreenCTM();
      if (!matrix) return false;
      const locked = { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f };
      const point = planePointFromClient({ x: event.clientX, y: event.clientY }, locked);
      if (!point || !svg.current) return false;
      event.preventDefault(); event.stopPropagation();
      svg.current.setPointerCapture(event.pointerId);
      active.current = { data, pointerId: event.pointerId, start: point, clientStart: { x: event.clientX, y: event.clientY }, moved: false, matrix: locked };
      return true;
    },
    handlers: {
      onPointerDownCapture(event: ReactPointerEvent) {
        if (active.current && active.current.pointerId !== event.pointerId) { cancel(); event.stopPropagation(); }
      },
      onPointerMove(event: ReactPointerEvent) { const next = frame(event); if (next) { event.preventDefault(); callbacks.onMove(next); } },
      onPointerUp(event: ReactPointerEvent) { const next = frame(event); if (next) { release(); callbacks.onFinish(next); } },
      onPointerCancel(event: ReactPointerEvent) { if (active.current?.pointerId === event.pointerId) cancel(); },
      onLostPointerCapture(event: ReactPointerEvent) { if (active.current?.pointerId === event.pointerId) cancel(); },
    },
  };
}
