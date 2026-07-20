"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 通用"舞台 contain"缩放容器（docs/plan/19-p4i-final.md §12.2/§17.4）。
 * 与 `DocStage.tsx`（按容器宽度撑满、纵横比跟随）不同——这里宽高都可能
 * 是瓶颈，按 `min(容器宽/内容宽, 容器高/内容高)` 缩放并居中，默认不放大
 * 超过 100%。`DocStage` 是课件渲染专用逻辑，不在本组件里泛化两种模式。
 */
export function StageViewport({
  intrinsicWidth,
  intrinsicHeight,
  allowUpscale = false,
  children,
  className,
}: {
  intrinsicWidth: number;
  intrinsicHeight: number;
  allowUpscale?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(container);
    setSize({ width: container.clientWidth, height: container.clientHeight });
    return () => observer.disconnect();
  }, []);

  const rawScale = size.width > 0 && size.height > 0
    ? Math.min(size.width / intrinsicWidth, size.height / intrinsicHeight)
    : 0;
  const scale = allowUpscale ? rawScale : Math.min(rawScale, 1);

  return (
    <div
      ref={containerRef}
      className={cn("relative flex h-full w-full items-center justify-center overflow-hidden", className)}
    >
      <div
        style={{
          width: intrinsicWidth,
          height: intrinsicHeight,
          transform: `scale(${scale})`,
          visibility: scale > 0 ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}
