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
 * 窄屏单行横向滚动（§17）：标签一多就换行会把 sticky 顶部撑成两三行，移动端
 * 预算是整个顶部不超过视口约四分之一。
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
    <nav aria-label={ariaLabel} className={cn("-mx-1 min-w-0 max-w-full overflow-x-auto px-1 py-0.5", className)}>
      <div className="inline-flex h-9 w-max items-center gap-0.5 rounded-lg bg-line/40 p-1 text-muted">
        {items.map((item) => {
          const active = item.value === activeValue;
          return (
            <Link
              key={item.value}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm transition-all",
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
