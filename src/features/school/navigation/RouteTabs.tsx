import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export interface RouteTab {
  value: string;
  label: string;
  href: string;
  /** 可选计数徽标，例如"逾期 3"。 */
  badge?: ReactNode;
}

/**
 * URL 驱动的互斥切换（doc 23 §4.3B）。
 *
 * 之前有两套：命令面板里的 DashboardCommandTabs（链接 + 分段控件外观）和对象工作区
 * 的 ContextBar（Radix Tabs 包着 Link，靠 `onValueChange: noop` 把受控状态废掉）。
 * 两者做的是同一件事——一组指向不同 URL 的导航链接——却在窄屏行为、徽标、active
 * 标记上各走各的。ContextBar 那种写法还额外带来一个客户端组件和"看起来是 Tab、
 * 实际是导航"的无障碍歧义。
 *
 * 这里只保留一种实现：一组链接 + `aria-current="page"`。状态本来就在 URL 上
 * （`?tab=`/`?stage=`/`?scope=`），服务端据此取不同数据，本组件不持有任何状态，
 * 因此可以是 Server Component。键盘访问由链接天然提供，不需要 roving tabindex。
 *
 * 窄屏换行而不是横向滚动：横向滚动条在没有触控板的桌面端等于把后几个标签藏起来
 * ——没有滚动提示，用户不知道"监护人""费用"还在右边。换行至多多占一行，
 * 但每个标签都始终可见可点。
 *
 * doc 24 §3.1 复核后的三处收口：
 *   - `max-w-full`：`w-fit` 是 `min(max-content, 可用宽度)`，只有在祖先真的传下了可用
 *     宽度时才自动收敛。命令面板的 filters 槽是 flex 行，一旦某个兄弟元素把行撑开，
 *     这里就会跟着按 max-content 铺开，产生 1–2px 级的画布横向溢出。
 *   - `gap-y-1`：换行后两行标签只隔 2px（gap-0.5），active 底片会黏成一整块。
 *   - `min-h-8`：换行后的标签是 390px 下的主要点击区域，28px 行高偏小。
 */
export function RouteTabs({
  items,
  activeValue,
  ariaLabel,
  className,
}: {
  items: readonly RouteTab[];
  activeValue: string;
  ariaLabel: string;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={ariaLabel} className={cn("min-w-0", className)}>
      <div className="flex min-h-9 w-fit max-w-full flex-wrap items-center gap-x-0.5 gap-y-1 rounded-lg bg-line/40 p-1 text-muted">
        {items.map((item) => {
          const active = item.value === activeValue;
          return (
            <Link
              key={item.value}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm transition-all",
                active ? "bg-card font-medium text-ink shadow-sm" : "hover:text-ink",
              )}
            >
              {item.label}
              {item.badge !== undefined ? <span className="tabular-nums">{item.badge}</span> : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
