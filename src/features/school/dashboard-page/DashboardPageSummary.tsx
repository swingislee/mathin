import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DashboardPageSection } from "./DashboardPageSection";

/**
 * 只读摘要区（历史设计：archive/2026-10-04/docs/plan/21-dashboard-unified-canvas-command-panel-refactor.md §15.3）。StatusStrip 这类"今日 12 / 待处理 7"进这里，
 * 可交互的状态切换进 DashboardCommandState——只读数字不允许长得像筛选按钮。
 */
export function DashboardPageSummary({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <DashboardPageSection data-dashboard-page-slot="summary" className={cn("min-w-0", className)}>
      {children}
    </DashboardPageSection>
  );
}
