"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { analyzeSudokuCoursewareActivity } from "./activity";
import { analyzeSudokuPuzzle, solveSudokuGrid } from "./logic";
import {
  type SudokuActivityPayload,
  type SudokuAuthoredPayload,
  type SudokuCoursewarePayload,
  createDefaultSudokuActivityPayload,
  createDefaultSudokuAuthoredPayload,
} from "./courseware-contract";
import { SudokuVariantSelector } from "./SudokuVariantSelector";
import { resolveSudokuVariant, type SudokuVariantId } from "./variant";

export interface SudokuPuzzleEditorProps {
  payload: SudokuCoursewarePayload;
  onChange: (payload: SudokuCoursewarePayload) => void;
}

export function SudokuPuzzleEditor({ payload, onChange }: SudokuPuzzleEditorProps) {
  const t = useTranslations("teacherMicrocourses");
  const variant = resolveSudokuVariant(payload.variantId);
  const [pendingVariantId, setPendingVariantId] = useState<SudokuVariantId | null>(null);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const puzzleAnalysis = useMemo(
    () => analyzeSudokuPuzzle(payload.puzzle, payload.variantId),
    [payload.puzzle, payload.variantId],
  );
  const activityAnalysis = useMemo(
    () => analyzeSudokuCoursewareActivity(payload),
    [payload],
  );
  const activity = payload.kind === "authored-activity" ? payload : null;
  const targetIndexes = new Set(
    activity?.goal.kind === "teaching-target"
      ? activity.goal.targets.map((target) => target.index)
      : [],
  );

  const applyVariant = (variantId: SudokuVariantId) => {
    onChange(payload.kind === "authored-activity"
      ? createDefaultSudokuActivityPayload(variantId)
      : createDefaultSudokuAuthoredPayload(variantId));
    setSelectedCell(null);
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
    onChange(payload.kind === "authored-activity" && payload.goal.kind === "teaching-target"
      ? {
          ...payload,
          puzzle,
          goal: {
            ...payload.goal,
            targets: digit === 0
              ? payload.goal.targets
              : payload.goal.targets.filter((target) => target.index !== index),
          },
        }
      : { ...payload, puzzle });
  };
  const setDisplay = (key: keyof SudokuAuthoredPayload["display"], value: boolean) => {
    onChange({ ...payload, display: { ...payload.display, [key]: value } });
  };
  const setGoal = (kind: SudokuActivityPayload["goal"]["kind"]) => {
    if (!activity) return;
    const goal: SudokuActivityPayload["goal"] = kind === "full-solution"
      ? { kind, requireUnique: true }
      : kind === "teaching-target"
        ? { kind, targets: [] }
        : { kind };
    onChange({
      ...activity,
      goal,
      display: kind === "teacher-led"
        ? { ...activity.display, allowAnswerReveal: false }
        : activity.display,
    });
  };
  const toggleSelectedTarget = () => {
    if (!activity || activity.goal.kind !== "teaching-target" || selectedCell === null) return;
    const existing = activity.goal.targets.find((target) => target.index === selectedCell);
    if (existing) {
      onChange({
        ...activity,
        goal: {
          ...activity.goal,
          targets: activity.goal.targets.filter((target) => target.index !== selectedCell),
        },
      });
      return;
    }
    if (activity.puzzle[selectedCell] !== 0) return;
    const value = solveSudokuGrid(activity.puzzle, activity.variantId)?.[selectedCell] ?? 0;
    if (!value) return;
    onChange({
      ...activity,
      goal: {
        ...activity.goal,
        targets: [...activity.goal.targets, { kind: "cell-value", index: selectedCell, value }],
      },
    });
  };
  const selectedCoordinate = selectedCell === null
    ? ""
    : `${String.fromCharCode(65 + Math.floor(selectedCell / variant.size))}${selectedCell % variant.size + 1}`;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">{t("sudokuPrototype", { size: variant.size })}</h3>
        <p className={cn("mt-1 text-xs", activityAnalysis.ready ? "text-leaf-deep" : "text-rose")}>
          {activity
            ? t(`sudokuActivity_${activityAnalysis.code}`)
            : t(`sudoku_${puzzleAnalysis.status}`)}
        </p>
      </div>
      {activity ? (
        <div>
          <p className="text-xs text-muted">{t("sudokuActivityGoal")}</p>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {(["teacher-led", "teaching-target", "full-solution"] as const).map((kind) => (
              <Button
                key={kind}
                type="button"
                size="sm"
                variant={activity.goal.kind === kind ? "primary" : "secondary"}
                className="h-auto min-h-10 px-2 text-xs"
                onClick={() => setGoal(kind)}
              >
                {t(`sudokuGoal_${kind}`)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
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
              onFocus={() => setSelectedCell(index)}
              onChange={(event) => setDigit(index, event.target.value)}
              className={cn(
                "h-9 rounded-none border-0 border-r border-b border-line p-0 text-center text-sm",
                column === variant.size - 1 && "border-r-0",
                row === variant.size - 1 && "border-b-0",
                strongRight && "border-r-2 border-r-ink/40",
                strongBottom && "border-b-2 border-b-ink/40",
                selectedCell === index && "relative z-10 ring-2 ring-rose ring-inset",
                targetIndexes.has(index) && "bg-moon/60 font-semibold text-rose-deep",
              )}
            />
          );
        })}
      </div>
      {activity?.goal.kind === "teaching-target" ? (
        <div className="rounded-xl border border-line bg-paper/60 p-3">
          <p className="text-xs text-muted">{t("sudokuTeachingTargetHint")}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2 w-full"
            disabled={selectedCell === null || Boolean(selectedCell !== null && activity.puzzle[selectedCell])}
            onClick={toggleSelectedTarget}
          >
            {selectedCell === null
              ? t("sudokuSelectTargetCell")
              : targetIndexes.has(selectedCell)
                ? t("sudokuRemoveTarget", { coordinate: selectedCoordinate })
                : t("sudokuAddTarget", { coordinate: selectedCoordinate })}
          </Button>
        </div>
      ) : null}
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
