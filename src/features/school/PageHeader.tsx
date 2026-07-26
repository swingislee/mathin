import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Link } from "@/i18n/navigation";

/**
 * 后台子页统一页头（P4C-0 §3.3）。页面第一元素即页头，与侧栏顶部（同为 py-6 起点）
 * 严格等高，消除反馈④「右侧标题比左侧导航矮一截」。返回类按钮进 actions 槽。
 *
 * 保持同步（非 async）：TileWorkspace.tsx 是 Client Component，会直接渲染本组件；
 * React 不允许 Client Component 边界内出现 async 组件。
 */
export function SchoolPageHeader({
  title,
  eyebrow,
  actions,
  description,
  meta,
  breadcrumbs,
  backHref,
  backLabel,
}: {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  description?: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  meta?: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <header className="sticky top-0 z-30 -mx-4 border-b border-line bg-paper/95 backdrop-blur-md md:-mx-6 lg:-mx-8 2xl:-mx-10">
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="flex min-h-[76px] min-w-0 flex-col justify-center py-3 pl-20 pr-32 md:pl-20 lg:min-h-24 lg:px-8 2xl:px-10">
        {backHref && <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-xs text-muted transition hover:text-ink"><ArrowLeft size={14}/>{backLabel}</Link>}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <Breadcrumb className="mb-2">
            <BreadcrumbList>
              {breadcrumbs.map((item,index)=><span className="contents" key={`${item.label}-${index}`}>
                {index>0&&<BreadcrumbSeparator/>}
                <BreadcrumbItem>{item.href?<Link href={item.href} className="transition hover:text-ink">{item.label}</Link>:<BreadcrumbPage>{item.label}</BreadcrumbPage>}</BreadcrumbItem>
              </span>)}
            </BreadcrumbList>
          </Breadcrumb>
        )}
        {eyebrow && <p className="text-[11px] uppercase tracking-[0.18em] text-crater">{eyebrow}</p>}
        <h1 className="font-display text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
        {meta && <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">{meta}</div>}
      </div>
      {actions && <div className="flex min-h-12 shrink-0 items-center justify-end gap-2 px-4 pb-3 md:px-6 lg:min-h-0 lg:px-0 lg:pb-0 lg:pr-24 2xl:pr-24">{actions}</div>}
      </div>
    </header>
  );
}
