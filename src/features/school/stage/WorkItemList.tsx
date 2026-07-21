import type { ReactNode } from "react";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { WorkItemGroup } from "./WorkItemGroup";
import { WORK_ITEM_URGENCY_ORDER, type WorkItemRow, type WorkItemUrgencyBucket } from "./types";

function groupByBucketThenKey(items: readonly WorkItemRow[]) {
  const byBucket = new Map<WorkItemUrgencyBucket, Map<string, WorkItemRow[]>>();
  for (const item of items) {
    let byGroup = byBucket.get(item.urgencyBucket);
    if (!byGroup) {
      byGroup = new Map();
      byBucket.set(item.urgencyBucket, byGroup);
    }
    const list = byGroup.get(item.groupKey);
    if (list) list.push(item);
    else byGroup.set(item.groupKey, [item]);
  }
  return byBucket;
}

/**
 * 今日工作的统一工作项列表（docs/plan/19-p4i-final.md §6.4/§7.4）：先按
 * `urgencyBucket` 固定顺序分节，节内再按 `groupKey` 聚合成 `WorkItemGroup`。
 * `groupBy="none"` 时每个事项各自成组（不做对象合并），用于不需要分组的
 * 简单列表场景。桶内组的先后顺序沿用传入数组的顺序（真正的优先级排序由
 * `list_my_work_items` RPC 完成，本组件不重新排序）。
 */
export function WorkItemList({
  items,
  groupBy = "group",
  bucketLabels,
  getGroupHref,
  renderItemTitle,
  renderActions,
  emptyMessage,
  className,
}: {
  items: readonly WorkItemRow[];
  groupBy?: "group" | "none";
  bucketLabels?: Partial<Record<WorkItemUrgencyBucket, ReactNode>>;
  getGroupHref?: (representative: WorkItemRow) => string;
  renderItemTitle?: (item: WorkItemRow) => ReactNode;
  renderActions?: (item: WorkItemRow) => ReactNode;
  emptyMessage: string;
  className?: string;
}) {
  if (items.length === 0) return <EmptyState message={emptyMessage} />;

  const effectiveItems = groupBy === "none"
    ? items.map((item) => ({ ...item, groupKey: item.workKey }))
    : items;
  const byBucket = groupByBucketThenKey(effectiveItems);

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {WORK_ITEM_URGENCY_ORDER.filter((bucket) => byBucket.has(bucket)).map((bucket) => {
        const groups = byBucket.get(bucket);
        if (!groups) return null;
        return (
          <section key={bucket} className="flex flex-col gap-3">
            <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
              {bucketLabels?.[bucket] ?? bucket}
            </h2>
            <div className="flex flex-col gap-3">
              {Array.from(groups.entries()).map(([groupKey, groupItems]) => (
                <WorkItemGroup
                  key={groupKey}
                  items={groupItems}
                  getGroupHref={getGroupHref}
                  renderItemTitle={renderItemTitle}
                  renderActions={renderActions}
                  bucketLabels={bucketLabels}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
