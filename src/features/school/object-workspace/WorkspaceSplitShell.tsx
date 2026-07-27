import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * panel 工作区的主区 + Rail 分栏（doc 23 §4.3C）。
 *
 * 取代两份各写各的分栏：`LectureWorkspaceShell`（讲次专用，实际结构完全通用）和
 * 素材替换编辑器里那个写在业务组件内部的 `xl:grid-cols-[minmax(0,1fr)_22rem]`。
 * 两者做同一件事，却在断点、最小高度和窄屏退化上各不相同。
 *
 * 断点用 `@4xl/workspace` 而不是 `xl:`（§17）：固定 240px 侧栏 + gutter 之后，
 * 浏览器 1280px 时工作区可能只有 940px。按视口判断会在 1024–1280 之间反复判错，
 * 把 320px 的 Rail 挤进一个放不下它的主区旁边。
 *
 * 窄容器纵向堆叠：主区在上、Rail 在下。Rail 这时**绝不能**继承 `h-full`——
 * 那等于在纵向堆叠里跟主区抢同一份 100% 高度，会把主区整个挤出可视区。
 * 该规则住在 WorkspaceRail 自己身上，这里只负责方向。
 */
export function WorkspaceSplitShell({
  main,
  rail,
  className,
}: {
  /** 传 WorkspaceMain：panel 两个合法滚动区之一。 */
  main: ReactNode;
  /** 传 WorkspaceRail；没有决策区时可省略，此时主区独占整宽。 */
  rail?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-workspace-split-shell
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col @4xl/workspace:flex-row", className)}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{main}</div>
      {rail}
    </div>
  );
}
