"use client";

import { useState, type ReactNode } from "react";
import { Check, CircleAlert, Info, LoaderCircle, MonitorPlay, Presentation, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { preparationAction, type ClassroomRunMode, type ClassroomRunState } from "./preparation-contract";
import { classroomScheduleBounds, isOutsideClassroomSchedule, type ClassroomScheduleWindow } from "./schedule-contract";

export interface ClassroomPreparationCheck {
  key: string;
  status: "ready" | "pending" | "warning" | "info";
  label: string;
  hint?: string;
}

export function ClassroomPreparation({
  mode,
  runState,
  checks,
  beforeChecks,
  afterChecks,
  secondaryActions,
  preview,
  canEnter,
  blocked = false,
  pending = false,
  error,
  onEnter,
  schedule,
  onRehearse,
}: {
  mode: ClassroomRunMode;
  runState: ClassroomRunState;
  checks: readonly ClassroomPreparationCheck[];
  beforeChecks?: ReactNode;
  afterChecks?: ReactNode;
  secondaryActions?: ReactNode;
  preview?: ReactNode;
  canEnter: boolean;
  blocked?: boolean;
  pending?: boolean;
  error?: string | null;
  onEnter: () => void;
  schedule: readonly ClassroomScheduleWindow[];
  onRehearse: () => void;
}) {
  const t = useTranslations("classroom.preparation");
  const [offScheduleOpen, setOffScheduleOpen] = useState(false);
  const action = preparationAction(mode, runState);
  const disabled = pending || blocked || !canEnter;
  const requestEntry = () => {
    if (disabled) return;
    if (action === "start" && isOutsideClassroomSchedule(schedule, Date.now())) setOffScheduleOpen(true);
    else onEnter();
  };
  return (
    <section
      className={cn("w-full py-6", preview && "grid gap-6 lg:grid-cols-[minmax(20rem,0.78fr)_minmax(34rem,1.22fr)]")}
      data-classroom-preparation
      data-classroom-run-mode={mode}
      data-classroom-run-state={runState}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl text-ink">{t("title")}</h2>
          {mode !== "formal" && <Badge variant="secondary">{t(mode === "rehearsal" ? "rehearsal" : "offlineDrill")}</Badge>}
        </div>
        <p className="mt-2 text-sm leading-6 text-muted">{t(`hints.${action}`)}</p>
        {beforeChecks}
        <ul className="mt-5 divide-y divide-line">
          {checks.map((check) => {
            const Icon = { ready: Check, pending: LoaderCircle, warning: TriangleAlert, info: Info }[check.status];
            return (
              <li key={check.key} className="flex items-start gap-3 py-3" data-preparation-check={check.key}>
                <Icon aria-hidden size={17} className={cn("mt-0.5 shrink-0", {
                  "text-leaf-deep": check.status === "ready",
                  "text-crater": check.status === "warning",
                  "animate-spin text-muted motion-reduce:animate-none": check.status === "pending",
                  "text-muted": check.status === "info",
                })} />
                <div className="min-w-0">
                  <p className="text-sm text-ink">{check.label}</p>
                  {check.hint && <p className="mt-0.5 text-xs leading-5 text-muted">{check.hint}</p>}
                </div>
              </li>
            );
          })}
        </ul>
        {afterChecks}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {canEnter && <Button size="sm" disabled={disabled} onClick={requestEntry}>
            {pending ? <LoaderCircle aria-hidden size={16} className="animate-spin motion-reduce:animate-none" />
              : mode === "rehearsal" ? <Presentation aria-hidden size={16} /> : <MonitorPlay aria-hidden size={16} />}
            {t(`actions.${action}`)}
          </Button>}
          {secondaryActions}
        </div>
        {error && <p className="mt-3 flex items-center gap-2 text-xs text-rose" role="alert"><CircleAlert aria-hidden size={14} />{error}</p>}
      </div>
      {preview && <div className="min-w-0">{preview}</div>}
      <ClassroomStartConfirmation open={offScheduleOpen} onOpenChange={setOffScheduleOpen}
        schedule={schedule} disabled={disabled} onConfirm={onEnter} onRehearse={onRehearse} />
    </section>
  );
}

export function ClassroomStartConfirmation({ open, onOpenChange, schedule, disabled, onConfirm, onRehearse }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: readonly ClassroomScheduleWindow[];
  disabled: boolean;
  onConfirm: () => void;
  onRehearse: () => void;
}) {
  const t = useTranslations("classroom.preparation");
  const format = useFormatter();
  return <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("offScheduleTitle")}</DialogTitle>
            <DialogDescription>{t("offScheduleDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-sm text-muted">
            {schedule.some((window) => classroomScheduleBounds(window))
              ? schedule.map((window, index) => {
                const bounds = classroomScheduleBounds(window);
                return bounds ? <p key={index}>{t("scheduledWindow", {
                  start: format.dateTime(new Date(bounds.start), { dateStyle: "medium", timeStyle: "short" }),
                  end: format.dateTime(new Date(bounds.end), { dateStyle: "medium", timeStyle: "short" }),
                })}</p> : null;
              })
              : <p>{t("scheduleMissing")}</p>}
          </div>
          <DialogFooter className="flex-wrap">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("cancelStart")}</Button>
            <Button variant="secondary" disabled={disabled} onClick={() => { onOpenChange(false); onConfirm(); }}>{t("confirmFormalStart")}</Button>
            <Button disabled={disabled} onClick={() => { onOpenChange(false); onRehearse(); }}>{t("enterRehearsal")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>;
}
