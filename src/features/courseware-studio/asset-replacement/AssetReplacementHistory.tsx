"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { CoursewareSharedAssetDetail } from "../data";

/**
 * 回滚历史（doc 23 §13.3）。每一批替换是一次可回滚的事务，这里只负责把它们列出来
 * 并请求回滚——确认对话框与 action 调用留在 Controller，历史本身不拥有任何状态。
 */
export function AssetReplacementHistory({
  batches,
  pending,
  onRollback,
}: {
  batches: CoursewareSharedAssetDetail["batches"];
  pending: boolean;
  onRollback: (batchId: string) => void;
}) {
  const t = useTranslations("coursewareStudio");
  return (
    <section>
      <h3 className="text-xs uppercase tracking-[0.14em] text-muted">{t("assetReplacementHistory")}</h3>
      {batches.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t("assetReplacementHistoryEmpty")}</p>
      ) : (
        <div className="mt-2 space-y-2">
          {batches.map((batch) => (
            <div key={batch.id} className="rounded-xl border border-line p-3 text-xs text-muted">
              <p className="font-medium text-ink">
                {t(batch.mode === "publish_pointer" ? "assetHistoryPointer" : "assetHistoryBranch", { count: batch.selectedUsageCount })}
              </p>
              <p className="mt-1">{batch.note || "—"}</p>
              <p className="mt-1 font-mono">{batch.id.slice(0, 8)}…</p>
              {batch.status === "applied" ? (
                <Button className="mt-2" variant="secondary" size="sm" disabled={pending} onClick={() => onRollback(batch.id)}>
                  <RotateCcw className="size-3" />{t("assetRollback")}
                </Button>
              ) : (
                <p className="mt-2 text-leaf-deep">{t("assetRolledBack")}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
