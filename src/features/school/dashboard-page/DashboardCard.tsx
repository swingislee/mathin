import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 正文区块卡（doc 24 §4.2）。
 *
 * doc 21 统一了页面坐标系、doc 23 统一了对象页骨架，但"一张卡长什么样"始终留在每个
 * 调用点：仓库里同一角色的区块卡曾经同时存在 `rounded-xl p-5`、`rounded-2xl p-4`、
 * `rounded-2xl p-5`、裸 `border` 与 `border border-line` 五种写法，标题则在
 * `font-medium`、`font-medium text-ink`、`text-sm font-medium text-ink` 之间摇摆。
 * 单看每一处都合理，连着翻三页就是 doc 24 开篇说的"页面之间的视觉密度差异"。
 *
 * 这里只固定**外观**，不固定内容结构：标题、可选描述、右上操作槽、正文。它不接受
 * tone / 可折叠 / 主操作按钮——那些一旦进来，区块卡就会开始和命令面板抢"这一页能
 * 干什么"的答案（与 DashboardSummaryCard 同一条理由）。
 *
 * 两层标题字号是刻意的，不是漏统一：
 *   - 这里（正文区块）`text-base`，是页面正文的一级分区；
 *   - DashboardSummaryCard（侧栏摘要）`text-sm`，宽度只有四列，base 会换行。
 * 除这两档外不应再出现第三种卡片标题字号。
 */
export function DashboardCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  /** 省略时不渲染标题行——纯容器场景（如只放一张表格）也走同一套外观。 */
  title?: ReactNode;
  description?: ReactNode;
  /** 标题行右侧的次要操作（"全部展开""导出"一类），不是页面主操作。 */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <section data-dashboard-card className={cn("min-w-0 rounded-2xl border border-line bg-card p-5", className)}>
      {hasHeader ? (
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            {title !== undefined ? <h2 className="text-base font-medium text-ink">{title}</h2> : null}
            {description !== undefined ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
          </div>
          {actions !== undefined ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children !== undefined ? <div className={cn("min-w-0", hasHeader && "mt-4")}>{children}</div> : null}
    </section>
  );
}

/**
 * 列表/表格的卡片外壳：与 DashboardCard 同一圈边框和圆角，但不带内边距，
 * 让表头能贴到卡片边线上（表格自己有格内边距，再套一层 p-5 会出现双重留白）。
 */
export function DashboardCardShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section data-dashboard-card="shell" className={cn("min-w-0 overflow-hidden rounded-2xl border border-line bg-card", className)}>
      {children}
    </section>
  );
}

/**
 * Dashboard 顶层数据表的统一外壳。
 *
 * 表格内部的表头与数据行继续由 shadcn Table 负责；这里只固定数据表作为一个完整
 * 对象在页面上的边界，避免 `border-y`、直角表格和卡片表格三套语义并存。
 */
export function DashboardTableShell({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-dashboard-table-shell
      className={cn("min-w-0 overflow-hidden rounded-2xl border border-line bg-card", className)}
      {...props}
    />
  );
}

/**
 * 空状态（doc 24 §4.2「空状态高度」）。
 *
 * 过去空状态是一行 `p-5 text-sm text-muted` 的 `<p>`：高度约 60px，而它替换掉的表格
 * 有半屏高。于是"筛掉最后一条"这件事在视觉上等于整页塌陷，用户以为页面出错了。
 * 统一给一个最小高度，让空态与有数据态在版面上是同一块区域。
 */
export function DashboardEmptyCard({
  children,
  action,
  className,
}: {
  children: ReactNode;
  /** 空状态里的"去创建"一类补救入口，可选。 */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-dashboard-empty-card
      className={cn(
        "flex min-h-40 min-w-0 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-card p-8 text-center text-sm text-muted",
        className,
      )}
    >
      <p className="min-w-0">{children}</p>
      {action}
    </div>
  );
}
