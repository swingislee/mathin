"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/**
 * 按容器自身宽度决定分栏方向（docs/plan/27 §3 D4）。
 *
 * 容器查询解决不了这件事：`react-resizable-panels` 的方向是 JS 属性而不是 CSS
 * 声明，CSS 改不了它。所以这里用 ResizeObserver 测容器实宽——判据仍然是"这块工作区
 * 自己有多宽"，与容器查询同源，只是换了执行者。按视口断点判断会在 1024–1280 之间
 * 反复判错，因为固定侧栏和 gutter 已经先扣走了 240–304px。
 *
 * 首帧按 horizontal 渲染：Dashboard 工作区在 lg 以下本来就被外壳收成纵向滚动，
 * 真正会用到这个组件的宽度区间以横向为主。
 */
export function useSplitOrientation(
  minInlineSize: number,
): [RefObject<HTMLDivElement | null>, "horizontal" | "vertical"] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const { width } = element.getBoundingClientRect();
      setOrientation(width >= minInlineSize ? "horizontal" : "vertical");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [minInlineSize]);

  return [ref, orientation];
}
