"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ACTIVITY_TARGET_GRADES } from "./activity-grade-contract";
import type { ActivityRow } from "./activities";

export function ActivityGradesDialog({ activity, pending, onClose, onSave }: {
  activity: ActivityRow; pending: boolean; onClose: () => void; onSave: (grades: number[] | null) => void;
}) {
  const t = useTranslations("school.activityGrades");
  const [mode, setMode] = useState<"unknown" | "all" | "specific">(!activity.targetGrades ? "unknown" : activity.targetGrades.length ? "specific" : "all");
  const [grades, setGrades] = useState((activity.targetGrades ?? []).map(String));
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>{t("title")}</DialogTitle><DialogDescription>{activity.title} · {t("description")}</DialogDescription></DialogHeader>
    <ToggleGroup type="single" value={mode} disabled={pending} onValueChange={(value) => { if (value) setMode(value as typeof mode); }} variant="outline" className="flex-wrap justify-start">
      {(["unknown", "all", "specific"] as const).map((value) => <ToggleGroupItem key={value} value={value}>{t(value)}</ToggleGroupItem>)}
    </ToggleGroup>
    {mode === "specific" ? <ToggleGroup type="multiple" value={grades} onValueChange={setGrades} disabled={pending} variant="outline" aria-label={t("specific")} className="grid grid-cols-4 gap-2">
      {ACTIVITY_TARGET_GRADES.map((grade) => <ToggleGroupItem key={grade} value={String(grade)}>{t("grade", { grade })}</ToggleGroupItem>)}
    </ToggleGroup> : null}
    <DialogFooter><Button type="button" variant="ghost" disabled={pending} onClick={onClose}>{t("cancel")}</Button>
      <Button type="button" disabled={pending || (mode === "specific" && grades.length === 0)}
        onClick={() => onSave(mode === "unknown" ? null : mode === "all" ? [] : grades.map(Number).sort((a, b) => a - b))}>{t("save")}</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}
