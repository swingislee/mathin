"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { analyzeSudokuPuzzle } from "./logic";
import {
  type SudokuAuthoredPayload,
  createDefaultSudokuAuthoredPayload,
} from "./courseware-contract";
import { SudokuVariantSelector } from "./SudokuVariantSelector";
import { resolveSudokuVariant, type SudokuVariantId } from "./variant";

export interface SudokuPuzzleEditorProps {
  payload: SudokuAuthoredPayload;
  onChange: (payload: SudokuAuthoredPayload) => void;
}

export function SudokuPuzzleEditor({ payload, onChange }: SudokuPuzzleEditorProps) {
  const t = useTranslations("teacherMicrocourses");
  const variant = resolveSudokuVariant(payload.variantId);
  const [pendingVariantId, setPendingVariantId] = useState<SudokuVariantId | null>(null);
  const analysis = useMemo(
    () => analyzeSudokuPuzzle(payload.puzzle, payload.variantId),
    [payload.puzzle, payload.variantId],
  );

  const applyVariant = (variantId: SudokuVariantId) => {
    onChange(createDefaultSudokuAuthoredPayload(variantId));
    setPendingVariantId(null);
  };
  const requestVariant = (variantId: SudokuVariantId) => {
    if (variantId === payload.variantId) return;
    if (payload.puzzle.some((digit) => digit !== 0)) {
      setPendingVariantId(variantId);
      return;
    }
    applyVariant(variantId);
  };
  const setDigit = (index: number, raw: string) => {
    const parsed = Number(raw);
    const digit = raw !== "" && Number.isInteger(parsed) && parsed >= 1 && parsed <= variant.size
      ? parsed
      : 0;
    const puzzle = payload.puzzle.map((value, currentIndex) => (
      currentIndex === index ? digit : value
    ));
    onChange({ ...payload, puzzle });
  };
  const setDisplay = (key: keyof SudokuAuthoredPayload["display"], value: boolean) => {
    onChange({ ...payload, display: { ...payload.display, [key]: value } });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">{t("sudokuPrototype", { size: variant.size })}</h3>
        <p className={cn("mt-1 text-xs", analysis.status === "unique" ? "text-leaf-deep" : "text-rose")}>
          {t(`sudoku_${analysis.status}`)}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted">{t("sudokuVariant")}</p>
        <SudokuVariantSelector
          value={payload.variantId}
          surface="courseware-authored"
          className="mt-2 w-fit"
          onValueChange={requestVariant}
        />
      </div>
      <div
        className="grid overflow-hidden rounded-lg border-2 border-ink/50"
        style={{ gridTemplateColumns: `repeat(${variant.size}, minmax(0, 1fr))` }}
        data-testid="sudoku-authoring-grid"
        data-sudoku-variant={payload.variantId}
      >
        {payload.puzzle.map((digit, index) => {
          const row = Math.floor(index / variant.size);
          const column = index % variant.size;
          const strongRight = (column + 1) % variant.boxColumns === 0 && column < variant.size - 1;
          const strongBottom = (row + 1) % variant.boxRows === 0 && row < variant.size - 1;
          return (
            <Input
              key={index}
              aria-label={t("sudokuCell", { cell: index + 1 })}
              inputMode="numeric"
              maxLength={1}
              value={digit || ""}
              onChange={(event) => setDigit(index, event.target.value)}
              className={cn(
                "h-9 rounded-none border-0 border-r border-b border-line p-0 text-center text-sm",
                column === variant.size - 1 && "border-r-0",
                row === variant.size - 1 && "border-b-0",
                strongRight && "border-r-2 border-r-ink/40",
                strongBottom && "border-b-2 border-b-ink/40",
              )}
            />
          );
        })}
      </div>
      <div className="space-y-2">
        {(["showCoordinates", "allowCandidates", "allowAnswerReveal", "showTeachingTools"] as const).map((key) => (
          <Label key={key} className="flex items-center gap-2 text-sm font-normal">
            <Checkbox
              checked={payload.display[key]}
              onCheckedChange={(value) => setDisplay(key, value === true)}
            />
            {t(`sudokuOption_${key}`)}
          </Label>
        ))}
      </div>
      <ConfirmDialog
        open={pendingVariantId !== null}
        onOpenChange={(open) => { if (!open) setPendingVariantId(null); }}
        title={t("changeSudokuVariantTitle")}
        description={t("changeSudokuVariantDescription")}
        confirmLabel={t("changeSudokuVariantConfirm")}
        cancelLabel={t("cancel")}
        onConfirm={() => { if (pendingVariantId) applyVariant(pendingVariantId); }}
      />
    </div>
  );
}
