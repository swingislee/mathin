"use client";
/* eslint-disable @next/next/no-img-element -- private signed URLs are intentionally not routed through next/image. */

import { useTranslations } from "next-intl";
import type { CoursewareSharedAssetDetail } from "../data";
import { AssetReplacementControls } from "./AssetReplacementControls";
import { AssetReplacementHistory } from "./AssetReplacementHistory";
import type { StagedUpload } from "./AssetReplacementPreview";

/**
 * 素材替换的决策栏（doc 23 §13.2）：当前素材 / 上传与备注 / 应用替换 / 回滚历史。
 *
 * 原来这是编辑器内部一个手写的 `<aside className="space-y-4">`——和讲次工作区的
 * DecisionRail 做同一件事，却因为那个组件叫"决策栏"而没人想到复用。现在两边都用
 * 通用的 WorkspaceRail，本文件只负责内容。
 *
 * 应用按钮放在这里而不是对比卡里：看清楚在主区，动手在 Rail，避免边看新旧对比边误触。
 */
export function AssetReplacementRail({
  asset,
  batches,
  staged,
  note,
  pending,
  canStage,
  canApply,
  message,
  onFileChange,
  onNoteChange,
  onStage,
  onApply,
  onDiscardStaged,
  onRollback,
}: {
  asset: CoursewareSharedAssetDetail["asset"];
  batches: CoursewareSharedAssetDetail["batches"];
  staged: StagedUpload | null;
  note: string;
  pending: boolean;
  canStage: boolean;
  canApply: boolean;
  message: string;
  onFileChange: (file: File | null) => void;
  onNoteChange: (note: string) => void;
  onStage: () => void;
  onApply: () => void;
  onDiscardStaged: () => void;
  onRollback: (batchId: string) => void;
}) {
  const t = useTranslations("coursewareStudio");
  return (
    <>
      <section>
        <h3 className="text-xs uppercase tracking-[0.14em] text-muted">{t("assetCurrentPreview")}</h3>
        <img
          src={asset.previewUrl ?? ""}
          alt={asset.name || t("unnamedAsset")}
          className="mt-2 aspect-video w-full rounded-xl border border-line bg-paper object-contain"
        />
        <p className="mt-2 break-all font-mono text-[11px] text-muted">{asset.sha256}</p>
      </section>

      <AssetReplacementControls
        inputId="asset-replacement-file"
        staged={staged}
        note={note}
        pending={pending}
        canStage={canStage}
        canApply={canApply}
        message={message}
        onFileChange={onFileChange}
        onNoteChange={onNoteChange}
        onStage={onStage}
        onApply={onApply}
        onDiscardStaged={onDiscardStaged}
      />

      <AssetReplacementHistory batches={batches} pending={pending} onRollback={onRollback} />
    </>
  );
}
