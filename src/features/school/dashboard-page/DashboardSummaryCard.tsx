import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 侧栏摘要卡（doc 23 §5.2 两页验证后抽取）。
 *
 * 课程页与班级页重建之后，两边的 Aside 写出了同一份 DOM：一个圆角边框卡、
 * 一个 `text-sm font-medium` 标题、下面一段只读内容。抽取的门槛正是这个——
 * 先在两页各写一遍、确认形状真的一致，再合并；反过来先猜一个"通用摘要组件"
 * 必然会长出一堆布尔参数。
 *
 * 与 DashboardPageSummary 的区别：那个是页面正文顶部的**槽位**（一整块区域），
 * 这个是可以并排/堆叠的一张卡。
 *
 * 不接受 actions、不接受可折叠、不接受 tone：一旦摘要卡开始承担操作，
 * 它就会和命令面板抢"这一页能干什么"的答案。
 */
export function DashboardSummaryCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section data-dashboard-summary-card className={cn("rounded-2xl border border-line bg-card p-4", className)}>
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      {children}
    </section>
  );
}

export interface DashboardStat {
  label: string;
  value: ReactNode;
}

/**
 * 摘要卡里的两列数字栅格。数字用 `tabular-nums`，切换对象时同一位置的数字不横向抖动。
 * 两列是固定的：侧栏宽度是固定的 4 列，再多一列每个数字都要换行。
 */
export function DashboardStatGrid({ items, className }: { items: readonly DashboardStat[]; className?: string }) {
  return (
    <dl className={cn("mt-3 grid grid-cols-2 gap-x-4 gap-y-3", className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className="mt-0.5 truncate text-lg font-medium tabular-nums text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
