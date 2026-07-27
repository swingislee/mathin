import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 页头与命令面板共用的 sticky 栈（docs/plan/21 §13）。
 *
 * 两者一起 sticky 而不是各自 sticky：分开做就要为第二条手算 top 偏移，而那个偏移
 * 随标题行数、面包屑、描述换行不断变化，最终必然出现滚动缝隙或面板被标题压住。
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
        // 不加 border-b：chrome 与正文是同一块画布的上下段，分割线会把页头切成独立卡片。
        // 滚动时的层次由 bg-paper/95 + backdrop-blur 给出。
        "@container/chrome sticky top-0 z-30 min-w-0 bg-paper/95 backdrop-blur-md",
        "mx-[calc(var(--dashboard-gutter,0px)*-1)] px-[var(--dashboard-gutter,0px)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
