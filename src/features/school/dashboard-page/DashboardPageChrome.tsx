import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 页头与命令面板共用的滚动栈（历史设计：archive/2026-10-04/docs/plan/21-dashboard-unified-canvas-command-panel-refactor.md §13）。
 *
 * 窄屏与矮屏随正文滚动，宽屏的固定条件由 globals.css 与列表内滚动共用。
 * 宽屏将两者一起固定，标题或筛选换行后仍共用自然高度，保持滚动时的对齐。
 *
 * 负外边距把背景铺满整条 canvas（A→D），内边距再把内容推回统一左右边线（B→C），
 * 两者都读同一个 --dashboard-gutter，所以 chrome 与正文永远对齐。
 */
export function DashboardPageChrome({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-dashboard-page-chrome
      className={cn(
        // 不能写 w-full：显式 width:100% 会让宽度锁在父级内容宽上，负外边距只把整块
        // 往左推，右边线反而少一个 gutter。让它作为普通块级元素由外边距撑开。
        // Chrome 自身不画边：唯一结构线由 PageHeader 负责，命令面板与正文位于线下的
        // 同一工作区。滚动时的层次由 bg-paper/95 + backdrop-blur 给出。
        "@container/chrome relative z-30 min-w-0 bg-paper/95 backdrop-blur-md",
        "mx-[calc(var(--dashboard-gutter,0px)*-1)] px-[var(--dashboard-gutter,0px)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
