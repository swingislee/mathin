import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { GlobalFloatingControlsSafeArea, MainFloatingControlSafeArea } from "@/components/global-floating-controls";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * 对象工作区顶部条（docs/plan/19-p4i-final.md §17.3）。固定 64px，只承载
 * 返回入口/对象名称/必要上下文/状态/一个主动作/溢出菜单——不接受面包屑或
 * 副标题这类会在同页与其他元素重复的内容，那些放进调用方自己的正文里。
 *
 * 悬浮控件避让用的是与普通页页头同一套测量占位（docs/plan/21 §11.3），
 * 不再写死 pl-16 / pr-32 / lg:pr-24——那几个值只对"当时那几个按钮"成立。
 */
export function ObjectBar({
  title,
  backHref,
  backLabel,
  context,
  status,
  primaryAction,
  overflowSlot,
  floatingSafeArea = true,
  className,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  context?: ReactNode;
  status?: ReactNode;
  primaryAction?: ReactNode;
  overflowSlot?: ReactNode;
  /**
   * 工作区右侧另有决策栏时置 false：那时右上悬浮控件压的是决策栏而不是这条，
   * 安全区由决策栏自己让，这条再让一次就是白白丢掉一截可用宽度。
   */
  floatingSafeArea?: boolean;
  className?: string;
}) {
  return (
    <header className={cn("sticky top-0 z-30 grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 border-b border-line bg-paper/95 backdrop-blur-md", className)}>
      <MainFloatingControlSafeArea />
      <div className="flex min-h-16 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 lg:min-h-[76px]">
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
        {primaryAction || overflowSlot ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {primaryAction}
            {overflowSlot}
          </div>
        ) : null}
      </div>
      {floatingSafeArea ? <GlobalFloatingControlsSafeArea /> : <span />}
    </header>
  );
}
