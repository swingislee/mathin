"use client";

import { useEffect, useState } from "react";

export interface TilePointerDragState<T> {
  data: T;
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  deltaX: number;
  deltaY: number;
}

interface PointerCoordinates {
  pointerId: number;
  clientX: number;
  clientY: number;
  preventDefault(): void;
}

export interface PointerCaptureTarget {
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
}

interface PointerStartEvent extends PointerCoordinates {
  button: number;
  isPrimary: boolean;
  defaultPrevented: boolean;
  currentTarget: PointerCaptureTarget;
  stopPropagation(): void;
}

export interface TilePointerDragOptions<T> {
  threshold?: number;
  onStart?(drag: TilePointerDragState<T>): void;
  onMove?(drag: TilePointerDragState<T>): void;
  onEnd?(drag: TilePointerDragState<T>): void;
  onCancel?(drag: TilePointerDragState<T>): void;
}

type DragCallbacks<T> = TilePointerDragOptions<T> & { onChange?(drag: TilePointerDragState<T> | null): void };

/** 控制单个 Pointer 会话，供磁贴与业务拖拽共用，目标命中和持久化由调用方处理。 */
export function createTilePointerDragController<T>() {
  let session: { state: TilePointerDragState<T>; target: PointerCaptureTarget; active: boolean; threshold: number } | null = null;
  let suppressClickUntil = 0;

  const release = (current: NonNullable<typeof session>) => {
    try {
      if (current.target.hasPointerCapture(current.state.pointerId)) current.target.releasePointerCapture(current.state.pointerId);
    } catch {
      // 节点在结束时被卸载，浏览器已经释放捕获。
    }
  };

  const move = (event: PointerCoordinates, callbacks: DragCallbacks<T>) => {
    if (!session || session.state.pointerId !== event.pointerId) return;
    const current = session;
    current.state = { ...current.state, clientX: event.clientX, clientY: event.clientY,
      deltaX: event.clientX - current.state.startX, deltaY: event.clientY - current.state.startY };
    if (!current.active) {
      if (Math.hypot(current.state.deltaX, current.state.deltaY) < current.threshold) return;
      current.active = true;
      callbacks.onStart?.(current.state);
      if (session !== current) return;
    }
    event.preventDefault();
    callbacks.onChange?.(current.state);
    callbacks.onMove?.(current.state);
  };

  const cancel = (callbacks: DragCallbacks<T>, pointerId?: number) => {
    if (!session || (pointerId !== undefined && session.state.pointerId !== pointerId)) return;
    const current = session;
    session = null;
    release(current);
    if (current.active) {
      suppressClickUntil = Date.now() + 500;
      callbacks.onChange?.(null);
      callbacks.onCancel?.(current.state);
    }
  };

  return {
    begin(event: PointerStartEvent, data: T, callbacks: DragCallbacks<T> = {}, captureTarget = event.currentTarget): boolean {
      if (session || event.defaultPrevented || event.button !== 0 || !event.isPrimary) return false;
      try {
        captureTarget.setPointerCapture(event.pointerId);
      } catch {
        return false;
      }
      suppressClickUntil = 0;
      const threshold = Math.max(0, callbacks.threshold ?? 5);
      session = { target: captureTarget, threshold, active: threshold === 0, state: {
        data, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
        clientX: event.clientX, clientY: event.clientY, deltaX: 0, deltaY: 0,
      } };
      event.stopPropagation();
      if (session.active) {
        event.preventDefault();
        callbacks.onChange?.(session.state);
        callbacks.onStart?.(session.state);
      }
      return true;
    },
    move,
    end(event: PointerCoordinates, callbacks: DragCallbacks<T> = {}) {
      if (!session || session.state.pointerId !== event.pointerId) return;
      move(event, callbacks);
      if (!session) return;
      const current = session;
      session = null;
      release(current);
      if (current.active) {
        suppressClickUntil = Date.now() + 500;
        callbacks.onChange?.(null);
        callbacks.onEnd?.(current.state);
      }
    },
    cancel,
    onClickCapture(event: { detail: number; preventDefault(): void; stopPropagation(): void }) {
      if (event.detail === 0 || Date.now() > suppressClickUntil) return;
      suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    },
    dispose() {
      const current = session;
      session = null;
      if (current) release(current);
      suppressClickUntil = 0;
    },
  };
}

/** 将返回的 Pointer 事件绑到抓取面，onClickCapture 可绑到稳定的外层容器。 */
export function useTilePointerDrag<T>(options: TilePointerDragOptions<T> = {}) {
  const [drag, setDrag] = useState<TilePointerDragState<T> | null>(null);
  const [controller] = useState(() => createTilePointerDragController<T>());
  useEffect(() => () => controller.dispose(), [controller]);
  const callbacks: DragCallbacks<T> = { ...options, onChange: setDrag };
  return {
    drag,
    begin: (event: PointerStartEvent, data: T, captureTarget?: PointerCaptureTarget) => controller.begin(event, data, callbacks, captureTarget),
    onPointerMove: (event: PointerCoordinates) => controller.move(event, callbacks),
    onPointerUp: (event: PointerCoordinates) => controller.end(event, callbacks),
    onPointerCancel: (event: { pointerId: number }) => controller.cancel(callbacks, event.pointerId),
    onLostPointerCapture: (event: { pointerId: number }) => controller.cancel(callbacks, event.pointerId),
    onClickCapture: controller.onClickCapture,
    cancel: () => controller.cancel(callbacks),
  };
}
