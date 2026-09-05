import { cn } from "@/lib/utils";
import { DashboardPageBody } from "./DashboardPageBody";
import { DashboardPageChrome } from "./DashboardPageChrome";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { DashboardPageSection } from "./DashboardPageSection";
import { DashboardPageSummary } from "./DashboardPageSummary";
import type { DashboardPageProps } from "./dashboard-page.types";

/**
 * 所有普通 Dashboard 页面的统一外壳（docs/plan/21 §9）。
 *
 * 页面根部只有 `w-full min-w-0`：没有 mx-auto，没有 max-w-*，也没有宽度参数。
 * 左右边线 B/C 全部由 DashboardShell 的 gutter 决定，因此在页面之间切换时标题、
 * 命令面板和正文的边线一律不动——那正是过去 4xl/5xl/6xl/7xl 混用造成横向跳动的
 * 根因，恢复任何一种页面级限宽都会把它带回来。
 */
export function DashboardPage({
  title,
  eyebrow,
  meta,
  breadcrumbs,
  backHref,
  backLabel,
  commandPanel,
  summary,
  footer,
  density = "default",
  children,
  className,
  bodyClassName,
  contentClassName,
}: DashboardPageProps) {
  return (
    <div data-dashboard-page data-dashboard-page-density={density} className={cn("w-full min-w-0", className)}>
      <DashboardPageChrome>
        <DashboardPageHeader
          title={title}
          eyebrow={eyebrow}
          meta={meta}
          breadcrumbs={breadcrumbs}
          backHref={backHref}
          backLabel={backLabel}
        />
        {commandPanel}
        {summary ? <DashboardPageSummary className="pb-2 [&>div]:min-h-0 [&>div]:bg-transparent [&>div]:py-1">{summary}</DashboardPageSummary> : null}
      </DashboardPageChrome>

      <DashboardPageBody density={density} className={bodyClassName}>
        <DashboardPageSection data-dashboard-page-slot="content" className={contentClassName}>
          {children}
        </DashboardPageSection>

        {footer ? <DashboardPageSection data-dashboard-page-slot="footer">{footer}</DashboardPageSection> : null}
      </DashboardPageBody>
    </div>
  );
}
