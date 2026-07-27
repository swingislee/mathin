"use client";
/* eslint-disable @next/next/no-img-element -- private signed URLs and local staged blobs are intentionally not routed through next/image. */

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

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
}: {
  currentPreviewUrl: string | null;
  staged: StagedUpload;
  selectedCount: number;
  unselectedCount: number;
  frozenSelectedCount: number;
  mode: "publish_pointer" | "branch_rebind";
  trackLabel: string;
}) {
  const t = useTranslations("coursewareStudio");
  return (
    <section className="rounded-2xl border border-moon bg-card p-4">
      <div className="flex items-center gap-2">
        <Check className="size-4 text-leaf-deep" />
        <h2 className="text-sm font-medium text-ink">{t("assetConfirmTitle")}</h2>
      </div>
      <p className="mt-1 text-sm text-muted">{t("assetConfirmHint")}</p>
      <div className="mt-4 grid gap-4 @2xl/page:grid-cols-2">
        <figure className="rounded-xl border border-line p-2">
          <img src={currentPreviewUrl ?? ""} alt={t("assetCurrentPreview")} className="aspect-video w-full rounded-lg bg-paper object-contain" />
          <figcaption className="mt-2 text-xs text-muted">{t("assetCurrentPreview")}</figcaption>
        </figure>
        <figure className="rounded-xl border border-line p-2">
          <img src={staged.previewUrl} alt={t("assetNewPreview")} className="aspect-video w-full rounded-lg bg-paper object-contain" />
          <figcaption className="mt-2 text-xs text-muted">{staged.fileName} · {staged.width} × {staged.height}</figcaption>
        </figure>
      </div>
      <div className="mt-4 rounded-xl bg-paper p-3 text-sm text-muted">
        <p>{t(mode === "publish_pointer" ? "assetPointerPlan" : "assetBranchPlan", { count: selectedCount, track: trackLabel })}</p>
        <p className="mt-1">{t("assetImpactSummary", { selected: selectedCount, unselected: unselectedCount, frozen: frozenSelectedCount })}</p>
        <p className="mt-1">{t("assetReleaseIsolation", { track: trackLabel })}</p>
      </div>
    </section>
  );
}
