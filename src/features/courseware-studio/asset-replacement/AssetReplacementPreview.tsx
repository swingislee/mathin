"use client";
/* eslint-disable @next/next/no-img-element -- private signed URLs and local staged blobs are intentionally not routed through next/image. */

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type StagedUpload = {
  uploadId: string;
  sha256: string;
  width: number;
  height: number;
  previewUrl: string;
  fileName: string;
};

/**
 * 新旧对比与替换影响（doc 23 §13.3）。
 *
 * 从单体编辑器拆出来，留在主工作区：这是"按下应用之前要看清楚的东西"，
 * 应该占主区宽度，而不是挤在 320px 的右栏里。真正的应用按钮在 Rail——
 * 看和做分开，避免边看对比边误触。
 */
export function AssetReplacementPreview({
  currentPreviewUrl,
  staged,
  selectedCount,
  unselectedCount,
  frozenSelectedCount,
  mode,
  trackLabel,
  compact = false,
}: {
  currentPreviewUrl: string | null;
  staged: StagedUpload;
  selectedCount: number;
  unselectedCount: number;
  frozenSelectedCount: number;
  mode: "publish_pointer" | "branch_rebind";
  trackLabel: string;
  compact?: boolean;
}) {
  const t = useTranslations("coursewareStudio");
  return (
    <section className={cn("border border-moon bg-card", compact ? "rounded-xl p-3" : "rounded-2xl p-4")}>
      <div className="flex items-center gap-2">
        <Check className="size-4 text-leaf-deep" />
        <h2 className="text-sm font-medium text-ink">{t("assetConfirmTitle")}</h2>
      </div>
      {!compact ? <p className="mt-1 text-sm text-muted">{t("assetConfirmHint")}</p> : null}
      <div className={cn("grid", compact ? "mt-3 grid-cols-2 gap-2" : "mt-4 gap-4 @2xl/page:grid-cols-2")}>
        <figure className="rounded-xl border border-line p-2">
          <img src={currentPreviewUrl ?? ""} alt={t("assetCurrentPreview")} className={cn("w-full rounded-lg bg-paper object-contain", compact ? "aspect-square" : "aspect-video")} />
          <figcaption className="mt-2 text-xs text-muted">{t("assetCurrentPreview")}</figcaption>
        </figure>
        <figure className="rounded-xl border border-line p-2">
          <img src={staged.previewUrl} alt={t("assetNewPreview")} className={cn("w-full rounded-lg bg-paper object-contain", compact ? "aspect-square" : "aspect-video")} />
          <figcaption className="mt-2 truncate text-xs text-muted">{staged.fileName} · {staged.width} × {staged.height}</figcaption>
        </figure>
      </div>
      <div className={cn("rounded-xl bg-paper text-muted", compact ? "mt-3 p-2 text-xs leading-5" : "mt-4 p-3 text-sm")}>
        <p>{t(mode === "publish_pointer" ? "assetPointerPlan" : "assetBranchPlan", { count: selectedCount, track: trackLabel })}</p>
        <p className="mt-1">{t("assetImpactSummary", { selected: selectedCount, unselected: unselectedCount, frozen: frozenSelectedCount })}</p>
        <p className="mt-1">{t("assetReleaseIsolation", { track: trackLabel })}</p>
      </div>
    </section>
  );
}
