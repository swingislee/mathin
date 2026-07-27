import type { ReactNode } from "react";
import { GlobalFloatingControlsSafeArea, MainFloatingControlSafeArea } from "@/components/global-floating-controls";

import { cn } from "@/lib/utils";
import { DashboardPageIdentity } from "./DashboardPageIdentity";
import type { DashboardPageBreadcrumb } from "./dashboard-page.types";

/**
 * 普通 Dashboard 页面的页头（docs/plan/21 §11）。
 *
 * 左右两侧是真实参与 Grid 的透明占位，而不是写死的 pl-20 / pr-32 / lg:pr-24。
 * 因此标题区可用范围 = C − 右上悬浮控件安全区，悬浮控件怎么变都不用回来改页面。
 */
export function DashboardPageHeader({
  title,
  eyebrow,
  description,
  meta,
  breadcrumbs,
  backHref,
  backLabel,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  breadcrumbs?: DashboardPageBreadcrumb[];
  backHref?: string;
  backLabel?: string;
  className?: string;
}) {
  return (
    <header data-dashboard-page-header className={cn("w-full min-w-0", className)}>
      <div className="grid min-h-16 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 py-2.5 @2xl/chrome:min-h-[76px] @2xl/chrome:py-3">
        <MainFloatingControlSafeArea />
        <DashboardPageIdentity
          title={title}
          eyebrow={eyebrow}
          description={description}
          meta={meta}
          breadcrumbs={breadcrumbs}
          backHref={backHref}
          backLabel={backLabel}
        />
        <GlobalFloatingControlsSafeArea />
      </div>
    </header>
  );
}
