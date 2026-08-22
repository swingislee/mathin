"use client";

import { useId, useState } from "react";
import { AlertTriangle, CalendarRange, LoaderCircle, Plus, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    <div className="grid gap-2 rounded-xl border border-line bg-paper/35 p-3 md:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 md:self-center">
        <p className="w-full font-medium text-ink">{periodLabel}</p>
        {period.isCurrent && <Badge className="px-2 py-0 text-[11px]" variant="secondary">{t("currentSchoolPeriod")}</Badge>}
        {!period.startsOn && !period.endsOn && <Badge className="px-2 py-0 text-[11px]" variant="outline">{t("datesPending")}</Badge>}
      </div>
      <Label className="grid gap-1 text-xs font-normal text-muted">
        {t("startsOn")}
        <DateTimePicker className="h-9" value={startsOn} onValueChange={setStartsOn} />
      </Label>
      <Label className="grid gap-1 text-xs font-normal text-muted">
        {t("endsOn")}
        <DateTimePicker className="h-9" value={endsOn} onValueChange={setEndsOn} />
      </Label>
      <div className="flex min-h-9 items-center md:justify-end">
        {changed ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || incomplete || reversed}
          onClick={() => onSave(period, startsOn || null, endsOn || null)}
        >
          <Save className="size-3.5" />
          {t("saveDates")}
        </Button>
        ) : yearActive && !period.isCurrent ? (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onActivate(period)}>
            {t("setCurrentPeriod")}
          </Button>
        ) : null}
      </div>
      {incomplete && <p role="alert" className="text-xs text-rose md:col-span-3 md:col-start-2">{t("termDatesIncomplete")}</p>}
      {reversed && <p role="alert" className="text-xs text-rose md:col-span-3 md:col-start-2">{t("termDatesReversed")}</p>}
      {overlap && (
        <p className="flex items-start gap-1.5 text-xs text-crater md:col-span-3 md:col-start-2">
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
  const yearSelectorId = useId();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(years.length === 0);
  const [selectedYearId, setSelectedYearId] = useState(
    years.find((row) => row.status === "active")?.id ?? years[0]?.id ?? "",
  );
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
  const createRun = useAction(createSchoolYearAction, {
    successMessage: t("schoolYearCreated"),
    errorMessage: errors,
    onSuccess: () => {
      setShowCreate(false);
      refresh();
    },
  });
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
  const selectedYear = years.find((row) => row.id === selectedYearId)
    ?? years.find((row) => row.status === "active")
    ?? years[0];
  const effectiveOn = selectedYear ? (effectiveDates[selectedYear.id] ?? "") : "";
  const effectiveDateValid = selectedYear ? effectiveOn.startsWith(`${selectedYear.startYear}-`) : false;
  const allPeriods = years.flatMap((row) => row.periods);

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
        <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b border-line px-6 py-5 pr-12">
            <DialogTitle>{t("schoolYears")}</DialogTitle>
            <DialogDescription>{t("schoolYearsHint")}</DialogDescription>
          </DialogHeader>

          <div className="border-b border-line bg-paper/30 px-6 py-3">
            <div className="flex flex-wrap items-end gap-3">
              {years.length > 0 && (
                <div className="min-w-64 flex-1 sm:max-w-sm">
                  <Label htmlFor={yearSelectorId} className="mb-1 block text-xs font-normal text-muted">{t("selectSchoolYear")}</Label>
                  <Select value={selectedYear?.id ?? ""} onValueChange={setSelectedYearId}>
                    <SelectTrigger id={yearSelectorId} className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((year) => (
                        <SelectItem key={year.id} value={year.id}>
                          {t("schoolYearName", { start: year.startYear, end: year.startYear + 1 })} · {t(`schoolYearStatus_${year.status}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="sm:ml-auto"
                aria-expanded={showCreate}
                onClick={() => setShowCreate((current) => !current)}
              >
                <Plus className="size-4" />
                {t("createSchoolYear")}
              </Button>
            </div>
            {showCreate && (
              <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
                <p className="text-xs leading-5 text-muted">{t("createSchoolYearHint")}</p>
                <Label className="grid gap-1 text-xs font-normal text-muted">
                  {t("schoolYearStart")}
                  <Input className="h-9" type="number" min={2020} max={2100} value={startYear} onChange={(event) => setStartYear(Number(event.target.value))} />
                </Label>
                <Button type="button" size="sm" disabled={pending || !validNewYear} onClick={() => createRun.run(startYear)}>
                  {createRun.pending && <LoaderCircle className="size-4 animate-spin" />}
                  {t("createSchoolYear")}
                </Button>
                {duplicateYear && <p role="alert" className="text-xs text-rose sm:col-span-3">{t("schoolYearAlreadyExists")}</p>}
              </div>
            )}
          </div>

          <div className="min-h-0 overflow-y-auto px-6 py-4">
            {!selectedYear && <p className="rounded-xl border border-line p-4 text-sm text-muted">{t("schoolYearsEmpty")}</p>}
            {selectedYear && (
              <section className="space-y-4">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-lg text-ink">{t("schoolYearName", { start: selectedYear.startYear, end: selectedYear.startYear + 1 })}</h3>
                    <p className="mt-1 text-xs text-muted">{t("schoolYearGradeRule")}</p>
                  </div>
                  <Badge variant={selectedYear.status === "active" ? "secondary" : "outline"}>{t(`schoolYearStatus_${selectedYear.status}`)}</Badge>
                </div>

                <div className="grid gap-2">
                  {selectedYear.periods.map((period) => (
                    <PeriodDates
                      key={`${period.id}:${period.startsOn ?? ""}:${period.endsOn ?? ""}`}
                      period={period}
                      allPeriods={allPeriods}
                      yearActive={selectedYear.status === "active"}
                      pending={pending}
                      onSave={(row, startsOn, endsOn) => dateRun.run({ termId: row.id, startsOn, endsOn })}
                      onActivate={(row) => termRun.run(row.id)}
                    />
                  ))}
                </div>

                {selectedYear.status === "active" && selectedYear.gradeEffectiveOn && (
                  <p className="text-xs text-muted">{t("gradeEffectiveOn", { date: selectedYear.gradeEffectiveOn })}</p>
                )}

                {selectedYear.status === "planning" && selectedYear.activationPreview && (
                  <div className="rounded-xl border border-star/55 bg-star/10 p-3">
                    <p className="text-sm text-ink">
                      {t("promotionPreview", {
                        promoteCount: selectedYear.activationPreview.promoteCount,
                        retainedCount: selectedYear.activationPreview.retainedCount,
                      })}
                    </p>
                    {selectedYear.activationPreview.canActivate ? (
                      <div className="mt-3 flex flex-wrap items-end gap-3">
                        <Label className="grid min-w-48 flex-1 gap-1 text-xs font-normal text-muted sm:max-w-xs">
                          {t("gradeEffectiveDate")}
                          <DateTimePicker
                            className="h-9"
                            value={effectiveOn}
                            onValueChange={(value) => setEffectiveDates((current) => ({ ...current, [selectedYear.id]: value }))}
                          />
                        </Label>
                        <Button type="button" size="sm" disabled={pending || !effectiveDateValid} onClick={() => setActivationTarget(selectedYear)}>
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
            )}
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
