"use client";

import { useEffect, useRef, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";

export const DEFAULT_LONG_PRESS_DELAY_MS = 500;
export const DEFAULT_LONG_PRESS_MOVEMENT_PX = 3;

/** 保留起按位置和元素，定时回调不依赖已经结束分发的 React 事件。 */
export interface LongPressInfo<T extends HTMLElement = HTMLElement> {
  currentTarget: T;
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
}

export interface LongPressOptions<T extends HTMLElement = HTMLElement> {
  onLongPress: (press: LongPressInfo<T>) => void;
  /** 普通点击及键盘激活；不提供时可交由 PopoverTrigger 等组件处理。 */
  onClick?: (event: MouseEvent<T>) => void;
  disabled?: boolean;
  delayMs?: number;
  movementThresholdPx?: number;
  /** 在提供长按操作的区域抑制系统右键/长按菜单，默认开启。 */
  preventContextMenu?: boolean;
}

/** 将返回值展开到实际操作元素；移动、取消、失焦和卸载会结束当前长按。 */
export function useLongPress<T extends HTMLElement = HTMLElement>({
  onClick, onLongPress, disabled = false, delayMs = DEFAULT_LONG_PRESS_DELAY_MS,
  movementThresholdPx = DEFAULT_LONG_PRESS_MOVEMENT_PX, preventContextMenu = true,
}: LongPressOptions<T>) {
  const stop = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  const callbacks = useRef({ onClick, onLongPress });
  useEffect(() => { callbacks.current = { onClick, onLongPress }; }, [onClick, onLongPress]);

  useEffect(() => {
    if (disabled) stop.current?.();
    return () => stop.current?.();
  }, [disabled]);

  return {
    onPointerDown: (event: ReactPointerEvent<T>) => {
      if (disabled || event.button !== 0 || event.isPrimary === false || stop.current) return;
      const view = event.currentTarget.ownerDocument.defaultView;
      if (!view) return;
      suppressClick.current = false;
      const press: LongPressInfo<T> = {
        currentTarget: event.currentTarget, pointerId: event.pointerId, pointerType: event.pointerType,
        clientX: event.clientX, clientY: event.clientY,
      };
      const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : DEFAULT_LONG_PRESS_DELAY_MS;
      const threshold = Number.isFinite(movementThresholdPx) ? Math.max(0, movementThresholdPx) : DEFAULT_LONG_PRESS_MOVEMENT_PX;
      const timer = view.setTimeout(() => {
        suppressClick.current = true;
        callbacks.current.onLongPress(press);
      }, delay);
      const move = (next: PointerEvent) => {
        if (next.pointerId !== press.pointerId) return;
        if (Math.hypot(next.clientX - press.clientX, next.clientY - press.clientY) > threshold) {
          suppressClick.current = true;
          view.clearTimeout(timer);
        }
      };
      const cleanup = () => {
        view.clearTimeout(timer);
        view.removeEventListener("pointermove", move, true);
        view.removeEventListener("pointerup", finish, true);
        view.removeEventListener("pointercancel", cancel, true);
        view.removeEventListener("blur", abort);
        stop.current = null;
      };
      const finish = (next: PointerEvent) => {
        if (next.pointerId !== press.pointerId) return;
        move(next);
        cleanup();
      };
      const abort = () => {
        suppressClick.current = true;
        cleanup();
      };
      const cancel = (next: PointerEvent) => {
        if (next.pointerId === press.pointerId) abort();
      };
      stop.current = abort;
      // 捕获阶段只观察指针，子组件停止冒泡也能正确结束计时。
      view.addEventListener("pointermove", move, true);
      view.addEventListener("pointerup", finish, true);
      view.addEventListener("pointercancel", cancel, true);
      view.addEventListener("blur", abort);
    },
    onClick: (event: MouseEvent<T>) => {
      if (disabled || (event.detail !== 0 && suppressClick.current)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      callbacks.current.onClick?.(event);
    },
    onContextMenu: (event: MouseEvent<T>) => {
      if (!disabled && preventContextMenu) event.preventDefault();
    },
  };
}
