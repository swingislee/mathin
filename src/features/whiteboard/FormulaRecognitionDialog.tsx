"use client";

import { renderToString } from "katex";
import { LoaderCircle } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export type FormulaRecognitionState = "idle" | "recognizing" | "ready" | "error";

export function FormulaRecognitionDialog({
  open,
  state,
  latex,
  error,
  onLatexChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  state: FormulaRecognitionState;
  latex: string;
  error: string | null;
  onLatexChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("whiteboard.board.tools");
  const markup = useMemo(
    () => latex.trim() ? renderToString(latex, { output: "mathml", throwOnError: false, strict: "ignore" }) : "",
    [latex],
  );
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("formulaDialogTitle")}</DialogTitle>
          <DialogDescription>{t("formulaDialogHint")}</DialogDescription>
        </DialogHeader>
        {state === "recognizing" ? (
          <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted">
            <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" />
            {t("formulaRecognizing")}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid min-h-24 place-items-center overflow-auto rounded-xl border border-line bg-card p-4 text-2xl" aria-label={t("formulaPreview")}>
              {markup ? <div dangerouslySetInnerHTML={{ __html: markup }} /> : <span className="text-sm text-muted">{t("formulaEmptyPreview")}</span>}
            </div>
            <Textarea
              value={latex}
              onChange={(event) => onLatexChange(event.target.value)}
              placeholder={t("formulaLatexPlaceholder")}
              aria-label={t("formulaLatexLabel")}
              rows={3}
              maxLength={4000}
              className="font-mono"
            />
            {state === "error" ? (
              <p role="alert" className="text-sm text-rose">{error || t("formulaFailed")}</p>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>{t("cancel")}</Button>
          <Button type="button" disabled={state === "recognizing" || !latex.trim()} onClick={onConfirm}>{t("formulaInsert")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
