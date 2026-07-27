import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DashboardPageDensity } from "./dashboard-page.types";

/**
 * 页面正文（docs/plan/21 §10）。三条硬规矩：不 mx-auto、不 max-w-*、不重复水平内边距。
 *
 * 它同时是页面的容器查询根。固定侧栏应用里"浏览器宽度 ≠ 页面可用宽度"，用视口断点
 * 排内部网格会在 1024–1280 之间反复判错，所以内部布局一律按 page 容器查询响应。
 */
const DENSITY_CLASSES: Record<DashboardPageDensity, string> = {
  compact: "gap-3 pt-4",
  default: "gap-4 pt-5",
  comfortable: "gap-6 pt-6",
};

export function DashboardPageBody({
  density,
  className,
  children,
}: {
  density: DashboardPageDensity;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-dashboard-page-body
      data-dashboard-page-density={density}
      className={cn("@container/page flex w-full min-w-0 flex-col", DENSITY_CLASSES[density], className)}
    >
      {children}
    </div>
  );
}
