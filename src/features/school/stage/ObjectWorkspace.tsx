import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * 单一 canonical 对象页壳层（docs/plan/19-p4i-final.md §2.2/§17.2）。
 * `scroll="ambient"`（默认）：正文随祖先 `main`（DashboardShell 已有的
 * 唯一滚动区）一起滚动，用于普通对象详情页；`scroll="internal"`：本组件
 * 自身持有唯一滚动区，要求父级给出受限高度（配合 FullScreenToolShell、
 * ObjectOverlay 或 DashboardShell 的 workspace 模式使用）。两种模式对应
 * §17.2"普通对象页主内容滚动"与"Studio/覆盖层/课次工作区内部滚动"。
 */
export function ObjectWorkspace({
  objectBar,
  contextBar,
  statusStrip,
  children,
  scroll = "ambient",
  className,
}: {
  objectBar: ReactNode;
  contextBar?: ReactNode;
  statusStrip?: ReactNode;
  children: ReactNode;
  scroll?: "ambient" | "internal";
  className?: string;
}) {
  if (scroll === "internal") {
    return (
      <div className={cn("flex h-full min-h-0 flex-col", className)}>
        {objectBar}
        {contextBar}
        <ScrollArea className="min-h-0 flex-1">
          <div className="py-6">{children}</div>
        </ScrollArea>
        {statusStrip}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col", className)}>
      {objectBar}
      {contextBar}
      <div className="py-6">{children}</div>
      {statusStrip}
    </div>
  );
}
