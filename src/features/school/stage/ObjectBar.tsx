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
    <header className={cn("flex h-16 shrink-0 items-center gap-3 border-b border-line", className)}>
      {backHref ? (
        <Link
          href={backHref}
          aria-label={backLabel}
          className="flex shrink-0 items-center justify-center rounded-full border border-line p-2 text-muted transition hover:border-crater hover:text-ink"
        >
          <ArrowLeft size={16} />
        </Link>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <h1 className="truncate font-display text-lg text-ink">{title}</h1>
        {context ? <div className="min-w-0 shrink-0 truncate text-sm text-muted">{context}</div> : null}
        {status}
      </div>
      {primaryAction}
      {overflowSlot}
    </header>
  );
}
