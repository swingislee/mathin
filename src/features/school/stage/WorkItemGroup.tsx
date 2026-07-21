import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { WorkItemRow, WorkItemUrgencyBucket } from "./types";

const BUCKET_BADGE_VARIANT: Record<WorkItemUrgencyBucket, "danger" | "default" | "secondary" | "outline"> = {
  now: "danger",
  overdue: "danger",
  today: "default",
  upcoming: "outline",
  backlog: "secondary",
};

function defaultItemTitle(item: WorkItemRow): string {
  return item.reasonCodes.length > 0 ? item.reasonCodes.join(" · ") : item.kind;
}

/**
 * 单个 groupKey 簇（docs/plan/19-p4i-final.md §7.4）：同一对象下多个事项
 * 合并展示，组头点击进入该对象的 canonical 工作区，组内逐条列出事项。
 * 本组件不认识应用的路由表，`routeTarget` 只是稳定对象引用
 * （如 `session:<id>`，P4I-6 迁移已约定），需要调用方通过 `getGroupHref`
 * 把它解析成真实 href——不传时组头不可点击，只作展示。
 */
export function WorkItemGroup({
  items,
  getGroupHref,
  renderItemTitle = defaultItemTitle,
  renderActions,
  bucketLabels,
  className,
}: {
  items: readonly WorkItemRow[];
  getGroupHref?: (representative: WorkItemRow) => string;
  renderItemTitle?: (item: WorkItemRow) => ReactNode;
  renderActions?: (item: WorkItemRow) => ReactNode;
  /** 桶名的展示文案；不传时退化显示原始英文键（now/overdue/...）。 */
  bucketLabels?: Partial<Record<WorkItemUrgencyBucket, ReactNode>>;
  className?: string;
}) {
  const head = items[0];
  if (!head) return null;
  const href = getGroupHref?.(head);

  const headerContent = (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{head.primaryObjectName}</p>
        {head.secondaryObjectName ? <p className="truncate text-xs text-muted">{head.secondaryObjectName}</p> : null}
      </div>
    </>
  );

  return (
    <Card className={cn("overflow-hidden py-0", className)}>
      {href ? (
        <Link
          href={href}
          className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-line/20 px-4 py-2.5 transition hover:bg-line/30"
        >
          {headerContent}
        </Link>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-line/20 px-4 py-2.5">
          {headerContent}
        </div>
      )}
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.workKey} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant={BUCKET_BADGE_VARIANT[item.urgencyBucket]}>{bucketLabels?.[item.urgencyBucket] ?? item.urgencyBucket}</Badge>
              <span className="truncate text-sm text-ink">{renderItemTitle(item)}</span>
            </div>
            {renderActions ? <div className="flex shrink-0 items-center gap-2">{renderActions(item)}</div> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
