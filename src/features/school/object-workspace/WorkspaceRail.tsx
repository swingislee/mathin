import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * panel 工作区的决策栏（doc 23 §4.3D）。
 *
 * 由讲次专用的 `DecisionRail` 泛化而来。壳层本来就是通用的——固定宽度、独立滚动、
 * 一个标题、一摞分区——只有内容是"课件校对决策"。名字里带业务语义的后果是：
 * 素材替换编辑器需要同样的东西时，没人会去复用一个叫"决策栏"的组件，于是又手写了
 * 一个 `<aside className="space-y-4">`。
 *
 * 这是 panel 里第二个、也是最后一个允许的纵向滚动区（另一个是 WorkspaceMain）。
 *
 * 悬浮安全区不再由 Rail 自己让：新的 ObjectWorkspace 把 ObjectBar 铺在整条工作区顶部，
 * Rail 从它下面开始，右上角的通知铃和菜单压的是 ObjectBar。旧结构里 Rail 与 ObjectBar
 * 并排，所以两边各让一次——那是"缺乏统一 workspace chrome 合同"的直接症状。
 */
export function WorkspaceRail({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside
      data-workspace-rail
      className={cn(
        // 窄容器：有限高度 + 自身滚动，堆在主区下面，不继承 h-full。
        "flex max-h-[45dvh] w-full shrink-0 flex-col border-t border-line",
        "@4xl/workspace:h-full @4xl/workspace:max-h-none @4xl/workspace:w-[320px] @4xl/workspace:border-l @4xl/workspace:border-t-0",
        className,
      )}
    >
      {title ? (
        <div className="shrink-0 border-b border-line px-4 py-3 text-sm font-medium text-ink">
          <span className="block truncate">{title}</span>
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-4">{children}</div>
      </ScrollArea>
    </aside>
  );
}
