import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 页面命令面板（docs/plan/21 §14）：状态切换、搜索筛选、页面业务操作的唯一落点。
 *
 * 它只负责编排与响应式，不拥有 URL 查询参数、业务状态、权限、数据请求或选择状态本身
 * ——那些留在页面和各自的控件里，面板换掉也不会带走业务。
 *
 * 用显式行列定位而不是 flex 换行：窄容器下必须**保证**"状态与主操作同一行、筛选独占
 * 第二行"，靠 flex-wrap 只是碰运气——状态标签或操作按钮一长就会各自另起一行，顶部
 * sticky 直接吃掉小半个视口（§13.2 给移动端的预算是不超过视口约四分之一）。
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
        "grid min-h-14 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-line/60 py-2",
        "@3xl/chrome:grid-cols-[auto_minmax(0,1fr)_auto]",
        className,
      )}
    >
      {selection ?? children}
    </div>
  );
}

/** 状态切换区：Tabs / ToggleGroup / Switch（§15）。窄容器下与主操作共用第一行。 */
export function DashboardCommandState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-dashboard-command-slot="state"
      className={cn("col-start-1 row-start-1 flex min-w-0 items-center gap-2", className)}
    >
      {children}
    </div>
  );
}

/** 搜索与筛选区：窄容器独占第二行，宽容器吃掉剩余空间把操作区顶到右边线 C。 */
export function DashboardCommandFilters({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-dashboard-command-slot="filters"
      className={cn(
        "col-span-2 col-start-1 row-start-2 flex min-w-0 items-center gap-2",
        "@3xl/chrome:col-span-1 @3xl/chrome:col-start-2 @3xl/chrome:row-start-1",
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
      className={cn(
        "col-start-2 row-start-1 flex shrink-0 items-center justify-self-end gap-2 @3xl/chrome:col-start-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 批量选择态：已选数量 + 批量操作 + 清除选择。整体替换默认面板，独占整行。 */
export function DashboardCommandSelection({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-dashboard-command-slot="selection"
      className={cn(
        "col-span-2 col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-2 text-sm @3xl/chrome:col-span-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
