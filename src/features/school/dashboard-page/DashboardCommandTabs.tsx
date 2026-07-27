import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export interface DashboardCommandTab {
  value: string;
  label: string;
  href: string;
  /** 可选计数徽标，例如"逾期 3"。 */
  badge?: ReactNode;
}

/**
 * 命令面板里的多状态互斥切换（docs/plan/21 §15.2）：当前 / 回收站、我的 / 全部、
 * 待处理 / 已完成。
 *
 * 用链接而不是 Radix Tabs：这些状态本来就是 URL 状态（`?tab=recycle`、`?scope=all`），
 * 服务端据此取不同数据。做成受控 Tabs 只会多一个客户端组件，还要把导航行为再手动接回去。
 * 视觉沿用 TabsList 的分段控件语言，交互语义是"一组导航链接 + aria-current"。
 */
export function DashboardCommandTabs({
  items,
  activeValue,
  ariaLabel,
  className,
}: {
  items: readonly DashboardCommandTab[];
  activeValue: string;
  ariaLabel: string;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label={ariaLabel}
      className={cn("inline-flex h-9 shrink-0 items-center gap-0.5 rounded-lg bg-line/40 p-1 text-muted", className)}
    >
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
    </nav>
  );
}
