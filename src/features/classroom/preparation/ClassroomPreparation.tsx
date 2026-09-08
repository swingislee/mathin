"use client";

import type { ReactNode } from "react";
import { Check, CircleAlert, Info, LoaderCircle, MonitorPlay, Presentation, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { preparationAction, type ClassroomRunMode, type ClassroomRunState } from "./preparation-contract";

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
}) {
  const t = useTranslations("classroom.preparation");
  const action = preparationAction(mode, runState);
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
          {canEnter && <Button size="sm" disabled={pending || blocked} onClick={onEnter}>
            {pending ? <LoaderCircle aria-hidden size={16} className="animate-spin motion-reduce:animate-none" />
              : mode === "rehearsal" ? <Presentation aria-hidden size={16} /> : <MonitorPlay aria-hidden size={16} />}
            {t(`actions.${action}`)}
          </Button>}
          {secondaryActions}
        </div>
        {error && <p className="mt-3 flex items-center gap-2 text-xs text-rose" role="alert"><CircleAlert aria-hidden size={14} />{error}</p>}
      </div>
      {preview && <div className="min-w-0">{preview}</div>}
    </section>
  );
}
