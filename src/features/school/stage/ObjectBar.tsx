import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * 对象工作区顶部条（docs/plan/19-p4i-final.md §17.3）。固定 64px，只承载
 * 返回入口/对象名称/必要上下文/状态/一个主动作/溢出菜单——不接受面包屑或
 * 副标题这类会在同页与其他元素重复的内容，那些放进调用方自己的正文里。
 */
export function ObjectBar({
  title,
  backHref,
  backLabel,
  context,
  status,
  primaryAction,
  overflowSlot,
  className,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  context?: ReactNode;
  status?: ReactNode;
  primaryAction?: ReactNode;
  overflowSlot?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("sticky top-0 z-30 grid shrink-0 border-b border-line bg-paper/95 backdrop-blur-md lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center", className)}>
      <div className="flex min-h-[76px] min-w-0 items-center gap-3 pl-16 pr-32 lg:min-h-24 lg:px-0">
        <h1 className="truncate font-display text-lg text-ink">{title}</h1>
        {context ? <div className="min-w-0 shrink-0 truncate text-sm text-muted">{context}</div> : null}
        {status}
        {backHref ? (
          <Link
            href={backHref}
            className="hidden shrink-0 items-center gap-1.5 text-sm text-muted transition hover:text-ink sm:inline-flex"
          >
            <ArrowLeft size={16} />
            {backLabel}
          </Link>
        ) : null}
      </div>
      {primaryAction || overflowSlot ? (
        <div className="flex min-h-12 shrink-0 items-center justify-end gap-2 pb-3 lg:min-h-0 lg:pb-0 lg:pr-24">
          {primaryAction}
          {overflowSlot}
        </div>
      ) : null}
    </header>
  );
}
