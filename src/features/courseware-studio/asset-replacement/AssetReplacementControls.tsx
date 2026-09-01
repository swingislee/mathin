"use client";

import { ImageUp, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { StagedUpload } from "./AssetReplacementPreview";

export function AssetReplacementControls({
  inputId,
  staged,
  note,
  pending,
  canStage,
  canApply,
  message,
  compact = false,
  onFileChange,
  onNoteChange,
  onStage,
  onApply,
  onDiscardStaged,
}: {
  inputId: string;
  staged: StagedUpload | null;
  note: string;
  pending: boolean;
  canStage: boolean;
  canApply: boolean;
  message: string;
  compact?: boolean;
  onFileChange: (file: File | null) => void;
  onNoteChange: (note: string) => void;
  onStage: () => void;
  onApply: () => void;
  onDiscardStaged: () => void;
}) {
  const t = useTranslations("coursewareStudio");
  return (
    <section className={cn(compact && "border-t border-line/70 pt-3")} data-courseware-asset-replacement-controls>
      {!compact ? <><h3 className="text-xs uppercase tracking-[0.14em] text-muted">{t("assetUploadTitle")}</h3><p className="mt-1 text-sm text-muted">{t("assetUploadHint")}</p></> : null}
      <div className={cn("space-y-2", !compact && "mt-3")}>
        <Label htmlFor={inputId}>{t("assetUploadFile")}</Label>
        <Input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        />
        {staged ? <>
          <Label htmlFor={`${inputId}-note`}>{t("saveNote")}</Label>
          <Textarea
            id={`${inputId}-note`}
            value={note}
            maxLength={1000}
            className={cn(compact && "min-h-16")}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder={t("assetReplacementNotePlaceholder")}
          />
        </> : null}
        {!staged ? <Button className="w-full" disabled={!canStage} onClick={onStage}>
          <Upload className="size-4" />{t("assetStageUpload")}
        </Button> : <>
          <Button className="w-full" disabled={!canApply} onClick={onApply}>
            <ImageUp className="size-4" />{t("assetApplyReplacement")}
          </Button>
          <Button className="w-full" variant="secondary" disabled={pending} onClick={onDiscardStaged}>
            {t("assetDiscardStaged")}
          </Button>
        </>}
      </div>
      {message ? <p role="status" className="mt-3 text-sm text-muted">{message}</p> : null}
    </section>
  );
}
