"use client";

import { useState } from "react";
import { AlertTriangle, CalendarRange, LoaderCircle, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import {
  activateSchoolTermAction,
  activateSchoolYearAction,
  createSchoolYearAction,
  updateSchoolTermDatesAction,
} from "./actions/courses";
import type { SchoolTermRow, SchoolYearRow } from "./courses";

function overlaps(startsOn: string, endsOn: string, currentId: string, periods: SchoolTermRow[]) {
  return periods.some((period) => period.id !== currentId
    && period.startsOn !== null
    && period.endsOn !== null
    && startsOn <= period.endsOn
    && endsOn >= period.startsOn);
}

function PeriodDates({
  period,
  allPeriods,
  yearActive,
  pending,
  onSave,
  onActivate,
}: {
  period: SchoolTermRow;
  allPeriods: SchoolTermRow[];
  yearActive: boolean;
  pending: boolean;
  onSave: (period: SchoolTermRow, startsOn: string | null, endsOn: string | null) => void;
  onActivate: (period: SchoolTermRow) => void;
}) {
  const t = useTranslations("school.schedule");
  const [startsOn, setStartsOn] = useState(period.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(period.endsOn ?? "");
  const incomplete = Boolean(startsOn) !== Boolean(endsOn);
  const reversed = Boolean(startsOn && endsOn && endsOn < startsOn);
  const overlap = Boolean(startsOn && endsOn && !reversed && overlaps(startsOn, endsOn, period.id, allPeriods));
  const changed = startsOn !== (period.startsOn ?? "") || endsOn !== (period.endsOn ?? "");
  const periodLabel = t(`period${period.term}`);

  return (
    <div className="rounded-xl border border-line bg-paper/35 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-24 font-medium text-ink">{periodLabel}</p>
        {period.isCurrent && <Badge variant="secondary">{t("currentSchoolPeriod")}</Badge>}
        {!period.startsOn && !period.endsOn && <Badge variant="outline">{t("datesPending")}</Badge>}
        <div className="ml-auto">
          {yearActive && !period.isCurrent && (
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onActivate(period)}>
              {t("setCurrentPeriod")}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Label className="grid gap-1 text-xs font-normal text-muted">
          {t("startsOn")}
          <Input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
        </Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">
          {t("endsOn")}
          <Input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
        </Label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || !changed || incomplete || reversed}
          onClick={() => onSave(period, startsOn || null, endsOn || null)}
        >
          <Save className="size-3.5" />
          {t("saveDates")}
        </Button>
      </div>
      {incomplete && <p role="alert" className="mt-2 text-xs text-rose">{t("termDatesIncomplete")}</p>}
      {reversed && <p role="alert" className="mt-2 text-xs text-rose">{t("termDatesReversed")}</p>}
      {overlap && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-crater">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t("termDatesOverlap")}
        </p>
      )}
    </div>
  );
}

/** 学年决定年级归属；暑/秋/寒/春只是可逐步补日期的运营周期。 */
export function TermManager({ years }: { years: SchoolYearRow[] }) {
  const t = useTranslations("school.schedule");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const suggestedYear = Math.max(new Date().getFullYear(), ...years.map((row) => row.startYear + 1));
  const [startYear, setStartYear] = useState(suggestedYear);
  const [effectiveDates, setEffectiveDates] = useState<Record<string, string>>({});
  const [activationTarget, setActivationTarget] = useState<SchoolYearRow | null>(null);

  const errors = {
    default: t("actionFailed"),
    SCHOOL_YEAR_ALREADY_EXISTS: t("schoolYearAlreadyExists"),
    SCHOOL_YEAR_SEQUENCE_INVALID: t("schoolYearSequenceInvalid"),
    SCHOOL_YEAR_EFFECTIVE_DATE_INVALID: t("schoolYearEffectiveDateInvalid"),
    SCHOOL_YEAR_PROMOTION_STALE: t("schoolYearPreviewStale"),
    SCHOOL_YEAR_NOT_ACTIVE: t("schoolYearNotActive"),
  };
  const refresh = () => router.refresh();
  const createRun = useAction(createSchoolYearAction, { successMessage: t("schoolYearCreated"), errorMessage: errors, onSuccess: refresh });
  const dateRun = useAction(updateSchoolTermDatesAction, { successMessage: t("termDatesSaved"), errorMessage: errors, onSuccess: refresh });
  const termRun = useAction(activateSchoolTermAction, { successMessage: t("schoolPeriodActivated"), errorMessage: errors, onSuccess: refresh });
  const yearRun = useAction(activateSchoolYearAction, {
    successMessage: t("schoolYearActivated"),
    errorMessage: errors,
    onSuccess: () => {
      setActivationTarget(null);
      refresh();
    },
  });
  const pending = createRun.pending || dateRun.pending || termRun.pending || yearRun.pending;
  const duplicateYear = years.some((row) => row.startYear === startYear);
  const validNewYear = Number.isInteger(startYear) && startYear >= 2020 && startYear <= 2100 && !duplicateYear;

  const confirmActivation = () => {
    if (!activationTarget?.activationPreview) return;
    const effectiveOn = effectiveDates[activationTarget.id] ?? "";
    yearRun.run({
      schoolYearId: activationTarget.id,
      effectiveOn,
      expectedPromoteCount: activationTarget.activationPreview.promoteCount,
    });
  };

  const activationDescription = activationTarget?.activationPreview
    ? t("schoolYearActivationConfirm", {
        name: t("schoolYearName", { start: activationTarget.startYear, end: activationTarget.startYear + 1 }),
        effectiveOn: effectiveDates[activationTarget.id] ?? "",
        promoteCount: activationTarget.activationPreview.promoteCount,
        retainedCount: activationTarget.activationPreview.retainedCount,
      })
    : "";

  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <CalendarRange className="size-4" />
        {t("schoolYears")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("schoolYears")}</DialogTitle>
            <DialogDescription>{t("schoolYearsHint")}</DialogDescription>
          </DialogHeader>

          <section className="rounded-2xl border border-line bg-card p-4">
            <h3 className="font-medium text-ink">{t("createSchoolYear")}</h3>
            <p className="mt-1 text-xs leading-5 text-muted">{t("createSchoolYearHint")}</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Label className="grid min-w-48 gap-1 text-xs font-normal text-muted">
                {t("schoolYearStart")}
                <Input type="number" min={2020} max={2100} value={startYear} onChange={(event) => setStartYear(Number(event.target.value))} />
              </Label>
              <Button type="button" size="sm" disabled={pending || !validNewYear} onClick={() => createRun.run(startYear)}>
                {createRun.pending && <LoaderCircle className="size-4 animate-spin" />}
                {t("createSchoolYear")}
              </Button>
            </div>
            {duplicateYear && <p role="alert" className="mt-2 text-xs text-rose">{t("schoolYearAlreadyExists")}</p>}
          </section>

          <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
            {years.length === 0 && <p className="rounded-xl border border-line p-4 text-sm text-muted">{t("schoolYearsEmpty")}</p>}
            {years.map((year) => {
              const effectiveOn = effectiveDates[year.id] ?? "";
              const effectiveDateValid = effectiveOn.startsWith(`${year.startYear}-`);
              return (
                <section key={year.id} className="rounded-2xl border border-line bg-card p-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-lg text-ink">{t("schoolYearName", { start: year.startYear, end: year.startYear + 1 })}</h3>
                      <p className="mt-1 text-xs text-muted">{t("schoolYearGradeRule")}</p>
                    </div>
                    <Badge variant={year.status === "active" ? "secondary" : "outline"}>{t(`schoolYearStatus_${year.status}`)}</Badge>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {year.periods.map((period) => (
                      <PeriodDates
                        key={`${period.id}:${period.startsOn ?? ""}:${period.endsOn ?? ""}`}
                        period={period}
                        allPeriods={years.flatMap((row) => row.periods)}
                        yearActive={year.status === "active"}
                        pending={pending}
                        onSave={(row, startsOn, endsOn) => dateRun.run({ termId: row.id, startsOn, endsOn })}
                        onActivate={(row) => termRun.run(row.id)}
                      />
                    ))}
                  </div>

                  {year.status === "active" && year.gradeEffectiveOn && (
                    <p className="mt-3 text-xs text-muted">{t("gradeEffectiveOn", { date: year.gradeEffectiveOn })}</p>
                  )}

                  {year.status === "planning" && year.activationPreview && (
                    <div className="mt-4 rounded-xl border border-star/55 bg-star/10 p-3">
                      <p className="text-sm text-ink">
                        {t("promotionPreview", {
                          promoteCount: year.activationPreview.promoteCount,
                          retainedCount: year.activationPreview.retainedCount,
                        })}
                      </p>
                      {year.activationPreview.canActivate ? (
                        <div className="mt-3 flex flex-wrap items-end gap-3">
                          <Label className="grid min-w-48 gap-1 text-xs font-normal text-muted">
                            {t("gradeEffectiveDate")}
                            <Input
                              type="date"
                              value={effectiveOn}
                              onChange={(event) => setEffectiveDates((current) => ({ ...current, [year.id]: event.target.value }))}
                            />
                          </Label>
                          <Button type="button" size="sm" disabled={pending || !effectiveDateValid} onClick={() => setActivationTarget(year)}>
                            {t("reviewAndActivateSchoolYear")}
                          </Button>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted">{t("schoolYearSequenceHint")}</p>
                      )}
                      {effectiveOn && !effectiveDateValid && <p role="alert" className="mt-2 text-xs text-rose">{t("schoolYearEffectiveDateInvalid")}</p>}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={activationTarget !== null}
        onOpenChange={(next) => { if (!next) setActivationTarget(null); }}
        title={t("activateSchoolYearTitle")}
        description={activationDescription}
        confirmLabel={t("confirmPromotionAndActivate")}
        cancelLabel={t("cancel")}
        pending={yearRun.pending}
        onConfirm={confirmActivation}
      />
    </>
  );
}
