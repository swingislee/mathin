import type { ReactNode } from "react";

/**
 * 普通 Dashboard 页面的公开契约（docs/plan/21 §8）。
 *
 * 这里**故意没有** `width`。页面宽度的唯一决定者是 DashboardShell；一旦把
 * narrow/form/detail/list 这类宽度语义写进类型，历史上那套"按页面打宽度补丁"
 * 的做法就会立刻固化回来，页面之间又会开始横向跳动。内容需要限宽时在页面内部
 * 用 DashboardReadingColumn / DashboardMainColumn 解决，不在页面根部解决。
 */
export type DashboardPageDensity = "compact" | "default" | "comfortable";

export type DashboardPageBreadcrumb = {
  label: string;
  href?: string;
};

export type DashboardPageProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;

  breadcrumbs?: DashboardPageBreadcrumb[];
  backHref?: string;
  backLabel?: string;

  /** 页面级状态切换、筛选与业务操作。传 DashboardCommandPanel。 */
  commandPanel?: ReactNode;
  /** 只读摘要（StatusStrip 等），排在正文之前。 */
  summary?: ReactNode;
  /** 分页、合计一类的收尾区。 */
  footer?: ReactNode;

  density?: DashboardPageDensity;

  children: ReactNode;

  className?: string;
  bodyClassName?: string;
  contentClassName?: string;
};
