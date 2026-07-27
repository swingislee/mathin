import type { ReactNode } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { DashboardBackLink } from "./DashboardBackLink";
import type { DashboardPageBreadcrumb } from "./dashboard-page.types";

/**
 * 页面身份（docs/plan/21 §11.1）：返回、面包屑、eyebrow、标题、描述、元信息。
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
