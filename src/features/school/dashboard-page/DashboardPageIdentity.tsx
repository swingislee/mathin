import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { DashboardBackLink } from "./DashboardBackLink";
import type { DashboardPageBreadcrumb } from "./dashboard-page.types";

/**
 * 页面身份（历史设计：archive/2026-10-04/docs/plan/21-dashboard-unified-canvas-command-panel-refactor.md §11.1）：返回、面包屑、eyebrow、标题、描述、元信息。
 * 不接受业务 actions——那些统一进 DashboardCommandPanel，页头只回答"我在哪"。
 *
 * 保持同步（非 async）：TileWorkspace 一类 Client Component 也要能直接渲染它。
 */
export function DashboardPageIdentity({
  title,
  eyebrow,
  description,
  meta,
  breadcrumbs,
  backHref,
  backLabel,
  compact = false,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  breadcrumbs?: DashboardPageBreadcrumb[];
  backHref?: string;
  backLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    const parent = breadcrumbs?.filter(item => item.href).at(-1);
    const returnHref = backHref ?? parent?.href;
    const information = description || eyebrow;
    return (
      <div data-dashboard-page-identity className={cn("flex min-w-0 items-center gap-2", className)}>
        {returnHref ? <DashboardBackLink href={returnHref} label={backLabel ?? parent?.label ?? ""} iconOnly /> : null}
        <h1 className="min-w-0 truncate font-display text-lg leading-tight" title={typeof title === "string" ? title : undefined}>{title}</h1>
        {information ? (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-moon/20 hover:text-ink">
                <Info size={15} aria-hidden="true" />
                <span className="sr-only">{information}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-1 text-sm">
              {eyebrow ? <p className="text-xs text-crater">{eyebrow}</p> : null}
              {description ? <div className="text-muted">{description}</div> : null}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    );
  }

  return (
    <div data-dashboard-page-identity className={cn("flex min-w-0 flex-col justify-center", className)}>
      {backHref ? <DashboardBackLink href={backHref} label={backLabel ?? ""} className="mb-1" /> : null}
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <Breadcrumb className="mb-1">
          <BreadcrumbList>
            {breadcrumbs.map((item, index) => (
              <span className="contents" key={`${item.label}-${index}`}>
                {index > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {item.href ? <Link href={item.href} className="transition hover:text-ink">{item.label}</Link> : <BreadcrumbPage>{item.label}</BreadcrumbPage>}
                </BreadcrumbItem>
              </span>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}
      {eyebrow ? <p className="text-[11px] uppercase tracking-[0.18em] text-crater">{eyebrow}</p> : null}
      <h1 className="min-w-0 truncate font-display text-xl leading-tight @2xl/chrome:text-2xl">{title}</h1>
      {/* 移动端 sticky 高度必须受控（§13.2），描述压成一行、超出省略。 */}
      {description ? <p className="mt-0.5 line-clamp-1 text-sm text-muted @2xl/chrome:line-clamp-2">{description}</p> : null}
      {meta ? <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted">{meta}</div> : null}
    </div>
  );
}
