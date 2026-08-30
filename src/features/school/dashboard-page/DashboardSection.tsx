import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Dashboard 正文的语义分区。
 *
 * 分区只负责标题、说明、区内操作和纵向节奏，不画外框、上下分隔线或底色。
 * 数据边界交给 DashboardTableShell，表单依靠字段网格，避免每个 section 再套一张
 * 看似连续工作区、实为隐藏 Card 的容器。
 */
export function DashboardSection({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  contentClassName?: string;
}) {
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined;
  return (
    <section data-dashboard-section className={cn("min-w-0", className)} {...props}>
      {hasHeader ? (
        <header className="mb-3 flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title !== undefined ? <h2 className="text-sm font-medium text-ink">{title}</h2> : null}
            {description !== undefined ? <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p> : null}
          </div>
          {actions !== undefined ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("min-w-0", contentClassName)}>{children}</div>
    </section>
  );
}

/** 空状态属于当前 section，不另造带边框的空卡片。 */
export function DashboardEmptyState({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-dashboard-empty-state
      className={cn("grid min-h-40 min-w-0 place-items-center px-6 py-10 text-center text-sm text-muted", className)}
      {...props}
    />
  );
}
