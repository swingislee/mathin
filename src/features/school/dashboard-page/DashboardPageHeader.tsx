import type { ReactNode } from "react";
import { GlobalFloatingControlsSafeArea, MainFloatingControlSafeArea } from "@/components/global-floating-controls";

import { cn } from "@/lib/utils";
import { DashboardPageIdentity } from "./DashboardPageIdentity";
import { DashboardPageHeaderLayout } from "./DashboardPageHeaderLayout";
import type { DashboardPageBreadcrumb } from "./dashboard-page.types";
import styles from "./DashboardPageHeader.module.css";

/**
 * 标题、视图与主操作共用一行，筛选按实际工作区宽度移到下一行。
 * 命令组件保留原挂载位置与业务状态；CSS 将其槽位接入同一个网格。
 * 只有首行避让两侧悬浮入口，筛选与摘要继续使用完整正文宽度。
 */
export function DashboardPageHeader({
  title,
  eyebrow,
  description,
  meta,
  breadcrumbs,
  backHref,
  backLabel,
  commandPanel,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  breadcrumbs?: DashboardPageBreadcrumb[];
  backHref?: string;
  backLabel?: string;
  commandPanel?: ReactNode;
  className?: string;
}) {
  return (
    <header data-dashboard-page-header className={cn("w-full min-w-0 border-b border-line/60", styles.header, className)}>
      <DashboardPageHeaderLayout className={styles.layout}>
        <MainFloatingControlSafeArea />
        <DashboardPageIdentity
          title={title}
          eyebrow={eyebrow}
          description={description}
          meta={meta}
          breadcrumbs={breadcrumbs}
          backHref={backHref}
          backLabel={backLabel}
          compact
        />
        {commandPanel ? <div data-dashboard-page-commands className={styles.commands}>{commandPanel}</div> : null}
        <GlobalFloatingControlsSafeArea />
      </DashboardPageHeaderLayout>
    </header>
  );
}
