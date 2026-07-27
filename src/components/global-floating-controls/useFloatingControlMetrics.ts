"use client";

import { useEffect, useRef } from "react";
import {
  FLOATING_CONTROL_GAP,
  GLOBAL_FLOATING_CONTROLS_BLOCK_VAR,
  GLOBAL_FLOATING_CONTROLS_INLINE_VAR,
  MAIN_FLOATING_CONTROL_INLINE_VAR,
} from "./floating-controls.constants";

/**
 * 测量视口边缘悬浮控件的实际占位，并写进根元素的 CSS 变量（docs/plan/21 §12.3）。
 *
 * 用 `getBoundingClientRect` 而不是 `offsetWidth`：需要的是"控件离视口边缘多远"，
 * 这一项同时包含控件宽度与它自身的外边距/内边距，断点切换或浏览器缩放时会一起变。
 * ResizeObserver 盯控件自身（按钮增减、身份变化），同时盯 documentElement（视口尺寸
 * 与缩放），两者共用一个测量函数。
 *
 * 控件被 `display:none` 隐藏时 rect 全为 0，此时安全区归零——桌面端 Dashboard 左上
 * 没有主入口悬浮按钮，页头就不该再为它留白。
 */
export function useFloatingControlMetrics(side: "start" | "end") {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const root = document.documentElement;
    const inlineVar = side === "end" ? GLOBAL_FLOATING_CONTROLS_INLINE_VAR : MAIN_FLOATING_CONTROL_INLINE_VAR;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        root.style.setProperty(inlineVar, "0px");
        if (side === "end") root.style.setProperty(GLOBAL_FLOATING_CONTROLS_BLOCK_VAR, "0px");
        return;
      }
      const inlineSize =
        side === "end"
          ? window.innerWidth - rect.left + FLOATING_CONTROL_GAP
          : rect.right + FLOATING_CONTROL_GAP;
      root.style.setProperty(inlineVar, `${Math.max(0, Math.round(inlineSize))}px`);
      if (side === "end") {
        root.style.setProperty(GLOBAL_FLOATING_CONTROLS_BLOCK_VAR, `${Math.max(0, Math.round(rect.bottom + FLOATING_CONTROL_GAP))}px`);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(root);
    return () => {
      observer.disconnect();
      root.style.removeProperty(inlineVar);
      if (side === "end") root.style.removeProperty(GLOBAL_FLOATING_CONTROLS_BLOCK_VAR);
    };
  }, [side]);

  return ref;
}
