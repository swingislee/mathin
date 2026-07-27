"use client";
/* eslint-disable @next/next/no-img-element -- private signed URLs are intentionally not routed through next/image. */

import { ImageUp, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CoursewareSharedAssetDetail } from "../data";
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

      <section>
        <h3 className="text-xs uppercase tracking-[0.14em] text-muted">{t("assetUploadTitle")}</h3>
        <p className="mt-1 text-sm text-muted">{t("assetUploadHint")}</p>
        <div className="mt-3 space-y-2">
          <Label htmlFor="asset-replacement-file">{t("assetUploadFile")}</Label>
          <Input
            id="asset-replacement-file"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          />
          <Label htmlFor="asset-replacement-note">{t("saveNote")}</Label>
          <Textarea
            id="asset-replacement-note"
            value={note}
            maxLength={1000}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder={t("assetReplacementNotePlaceholder")}
          />
          <Button className="w-full" disabled={!canStage} onClick={onStage}>
            <Upload className="size-4" />{t("assetStageUpload")}
          </Button>
        </div>

        {staged ? (
          <div className="mt-3 space-y-2">
            <Button className="w-full" disabled={!canApply} onClick={onApply}>
              <ImageUp className="size-4" />{t("assetApplyReplacement")}
            </Button>
            <Button className="w-full" variant="secondary" disabled={pending} onClick={onDiscardStaged}>
              {t("assetDiscardStaged")}
            </Button>
          </div>
        ) : null}

        {message ? <p role="status" className="mt-3 text-sm text-muted">{message}</p> : null}
      </section>

      <AssetReplacementHistory batches={batches} pending={pending} onRollback={onRollback} />
    </>
  );
}
