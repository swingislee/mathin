import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * panel 工作区的主工作区（doc 23 §7.3 / §17）。
 *
 * ObjectWorkspace `internal` 把滚动责任交给它：这里是 panel 里两个合法纵向滚动区之一
 * （另一个是 WorkspaceRail）。放在独立文件而不是塞回壳层，是为了让"谁在滚动"在 JSX 上
 * 一眼可见——panel 页面最常见的回归就是不知不觉多出第三个滚动容器。
 */
export function WorkspaceMain({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode;
  className?: string;
  /** 内容盒的额外类名（内边距/纵向节奏）。 */
  contentClassName?: string;
}) {
  return (
    <ScrollArea data-workspace-main className={cn("min-h-0 min-w-0 flex-1", className)}>
      {/* @container/page：正文里的 DashboardContentGrid 一类网格在 panel 与普通页里
          按同一套断点响应，不需要为 panel 再写一份。 */}
      <div className={cn("@container/page flex min-w-0 flex-col gap-4 py-5", contentClassName)}>{children}</div>
    </ScrollArea>
  );
}
