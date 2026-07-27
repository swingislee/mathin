import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 页面命令面板（docs/plan/21 §14）：状态切换、搜索筛选、页面业务操作的唯一落点。
 *
 * 它只负责编排与响应式，不拥有 URL 查询参数、业务状态、权限、数据请求或选择状态本身
 * ——那些留在页面和各自的控件里，面板换掉也不会带走业务。
 *
 * 排布用 flex + order 而不是三列 Grid：窄容器下需要的是"状态与主操作同一行、筛选独占
 * 第二行"，Grid 做这件事要重排列定义，flex 只要换 order 和 basis，而且筛选数量不定时
 * 不会把 Grid 的列宽算崩。
 */
export function DashboardCommandPanel({
  children,
  selection,
  className,
}: {
  children?: ReactNode;
  /** 有选中项时整体替换默认面板（§14.7），避免顶部同时挤下两套控件。 */
  selection?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-dashboard-command-panel
      data-dashboard-command-mode={selection ? "selection" : "default"}
      className={cn(
        "flex min-h-14 min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line/60 py-2",
        className,
      )}
    >
      {selection ?? children}
    </div>
  );
}

/** 状态切换区：Tabs / ToggleGroup / Switch（§15）。固定宽度，不参与剩余空间分配。 */
export function DashboardCommandState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-dashboard-command-slot="state" className={cn("order-1 flex min-w-0 shrink-0 items-center gap-2", className)}>
      {children}
    </div>
  );
}

/**
 * 搜索与筛选区。窄容器下 `basis-full` 让它独占第二行（状态与主操作留在第一行），
 * 宽容器下变回弹性列并吃掉剩余空间，把操作区顶到右边线 C。
 */
export function DashboardCommandFilters({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-dashboard-command-slot="filters"
      className={cn(
        "order-3 flex min-w-0 flex-1 basis-full items-center gap-2 overflow-x-auto",
        "@3xl/chrome:order-2 @3xl/chrome:basis-auto @3xl/chrome:flex-wrap @3xl/chrome:overflow-visible",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 页面业务操作区：每页至多一个一级主操作，其余降级到更多菜单（§14.6）。 */
export function DashboardCommandActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-dashboard-command-slot="actions"
      className={cn("order-2 ml-auto flex shrink-0 items-center gap-2 @3xl/chrome:order-3", className)}
    >
      {children}
    </div>
  );
}

/** 批量选择态：已选数量 + 批量操作 + 清除选择。 */
export function DashboardCommandSelection({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-dashboard-command-slot="selection"
      className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm", className)}
    >
      {children}
    </div>
  );
}
