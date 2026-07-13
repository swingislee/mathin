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
  children,
  breadcrumbs,
  backHref,
  backLabel,
}: {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  children?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
      <div className="min-w-0">
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
        {children}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
