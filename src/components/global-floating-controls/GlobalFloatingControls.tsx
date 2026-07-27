"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useFloatingControlMetrics } from "./useFloatingControlMetrics";

/**
 * 右上角全局控制集群的测量壳（通知铃 + UtilitySheet）。
 * 只负责把自身占位写进 CSS 变量，不参与控件本身的样式与业务。
 */
export function GlobalFloatingControls({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useFloatingControlMetrics("end");
  return (
    <div ref={ref} data-global-floating-controls className={cn("pointer-events-auto flex items-center gap-2", className)}>
      {children}
    </div>
  );
}

/** 左上角主入口（Dashboard 移动端导航触发器）的测量壳。 */
export function MainFloatingControl({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useFloatingControlMetrics("start");
  return (
    <div ref={ref} data-main-floating-control className={className}>
      {children}
    </div>
  );
}
