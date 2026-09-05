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
        "flex min-h-14 min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-2 @3xl/chrome:grid",
        "@3xl/chrome:grid-cols-[auto_minmax(0,1fr)_auto]",
        className,
      )}
    >
      {selection ?? children}
    </div>
  );
}

/**
 * 状态切换区：Tabs / ToggleGroup / Switch（§15）。窄容器下与主操作共用第一行。
 *
 * `flex-wrap`（doc 24 §3.1）：这里放的是 RouteTabs 一族，它们的产品决定就是"放不下
 * 就换行、所有选项保持可见"。此前有两个页面靠给这个槽加 `overflow-x-auto` 来兜住
 * 溢出，那等于把决定反过来——桌面端没有滚动条提示，后几个标签就是消失了。
 */
export function DashboardCommandState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-dashboard-command-slot="state"
      className={cn("col-start-1 row-start-1 flex min-w-0 max-w-full flex-wrap items-center gap-2", className)}
    >
      {children}
    </div>
  );
}

/**
 * 搜索与筛选区：窄容器独占第二行，宽容器吃掉剩余空间把操作区顶到右边线 C。
 *
 * `flex-wrap` 同上：筛选控件有各自的 `min-w-*` 下限，不换行时它们会把这一行撑过
 * 画布宽度。画布是 `overflow-y-auto`，CSS 会把另一轴一并算成 `auto`，于是整块
 * Dashboard 主区静默地横向滚动起来——根节点宽度检查完全看不到这种溢出。
 */
export function DashboardCommandFilters({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-dashboard-command-slot="filters"
      className={cn(
        "col-span-2 col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-2",
        "@3xl/chrome:col-span-1 @3xl/chrome:col-start-2 @3xl/chrome:row-start-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * 页面业务操作区：每页至多一个一级主操作，其余降级到更多菜单（§14.6）。
 * 页面级与批量业务操作必须放在这里（或 selection 模式），不得在 DashboardTableShell
 * 上方再造一条工具栏；全选和逐列筛选／排序属于表头控件，不属于页面操作。
 */
export function DashboardCommandActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-dashboard-command-slot="actions"
      className={cn(
        "col-start-2 row-start-1 ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-self-end gap-2 @3xl/chrome:col-start-3",
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
