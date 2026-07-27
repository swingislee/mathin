import type { ReactNode } from "react";
import { GlobalFloatingControlsSafeArea } from "@/components/global-floating-controls";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * 决策栏（docs/plan/19-p4i-final.md §17.4）。桌面 320px 固定宽、与主区
 * 同高（`lg:h-full`），独立于主区滚动。`<1024` 时（§17.5）与主区改为
 * 上下堆叠而非左右并排——这时绝不能再继承 `h-full`（等于父级 100% 高度），
 * 否则会在纵向堆叠里跟主区抢占同一份 100% 高度，把主区挤出可视区；
 * 移动端改用有限高度（`max-h-[45vh]`）+ 自身滚动。
 */
export function DecisionRail({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside className={cn("flex max-h-[45vh] w-full shrink-0 flex-col lg:h-full lg:max-h-none lg:w-[320px] lg:border-l lg:border-line", className)}>
      {/*
        决策栏贴着工作区右边线，它的标题正好落在右上悬浮控件下面。整页右侧 padding
        取消后（docs/plan/21 §6.2），这里必须自己让出安全区——否则"校对与决策"会被
        通知铃和菜单压住。
      */}
      {title ? (
        <div className="flex shrink-0 items-center border-b border-line px-4 py-3 text-sm font-medium text-ink">
          <span className="min-w-0 truncate">{title}</span>
          <GlobalFloatingControlsSafeArea />
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-4">{children}</div>
      </ScrollArea>
    </aside>
  );
}
