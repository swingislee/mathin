import type { ReactNode } from "react";
import { DashboardPageBody } from "@/features/school/dashboard-page/DashboardPageBody";
import { DashboardPageChrome } from "@/features/school/dashboard-page/DashboardPageChrome";
import { cn } from "@/lib/utils";

/**
 * 对象工作区壳层（doc 23 §4.2 / §7.2 / §7.3）。
 *
 * 两种滚动模式，与路由合同的 shellMode 一一对应，不是各写各的：
 *
 *   `ambient`  ←→ shellMode: "page"
 *      正文随 DashboardShell 的 `<main>` 一起滚动，工作区自己不建滚动容器。
 *      顶部（ObjectBar + 导航）复用普通页面的 DashboardPageChrome、正文复用
 *      DashboardPageBody：同一个 sticky 栈、同一份 gutter 出血、同一个 `@container/page`。
 *      这正是 doc 23 §1.1 要求的"不得再造第二套页头/正文/宽度系统"——课程页和班级页
 *      与学生页的边线、容器查询断点因此天然一致，而不是靠两边各自对齐。
 *
 *   `internal` ←→ shellMode: "panel"
 *      `<main>` 不滚动，本组件只负责把顶部固定住、把剩余空间交出去；**滚动责任下沉**到
 *      children（WorkspaceMain / WorkspaceSplitShell）。这里刻意不再包一层 ScrollArea：
 *      包了就等于宣布"panel 只能有一个滚动区"，主区 + Rail 各自滚动的分栏工作区就得
 *      绕过壳层自己搭，于是又冒出第三套布局。
 *
 * 不接受业务布尔参数。需要主区/侧栏就组合 DashboardContentGrid（ambient）或
 * WorkspaceSplitShell（internal），不是给这里加开关。
 */
export function ObjectWorkspace({
  objectBar,
  navigation,
  commandPanel,
  statusStrip,
  children,
  scroll = "ambient",
  className,
}: {
  objectBar: ReactNode;
  /** ObjectTabs / StageNavigation / TrackSwitcher / ObjectContextSwitcher。 */
  navigation?: ReactNode;
  /** 与普通 Dashboard 页共用的状态、筛选与页面操作命令层。 */
  commandPanel?: ReactNode;
  /** 底部只读状态条（可选）。 */
  statusStrip?: ReactNode;
  children: ReactNode;
  scroll?: "ambient" | "internal";
  className?: string;
}) {
  const chrome = (
    <DashboardPageChrome>
      {objectBar}
      {navigation ? (
        <div data-object-workspace-navigation className="pb-2">
          {navigation}
        </div>
      ) : null}
      {commandPanel}
    </DashboardPageChrome>
  );

  if (scroll === "internal") {
    return (
      // @container/workspace（§17）：Rail 收不收、主区排几列，要看**工作区自己**有多宽，
      // 而不是浏览器有多宽——固定 240px 侧栏 + gutter 之后两者能差出一整个断点。
      <div
        data-object-workspace="internal"
        className={cn("@container/workspace flex h-full min-h-0 w-full min-w-0 flex-col", className)}
      >
        {chrome}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        {statusStrip ? <div className="shrink-0 pb-1 pt-2">{statusStrip}</div> : null}
      </div>
    );
  }

  return (
    <div data-object-workspace="ambient" className={cn("@container/workspace w-full min-w-0", className)}>
      {chrome}
      <DashboardPageBody density="default">
        {children}
        {statusStrip}
      </DashboardPageBody>
    </div>
  );
}
