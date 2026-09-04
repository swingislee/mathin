"use client";

import { CalendarDays, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { addCalendarDays, startOfWeek, zonedDateParts, zonedDateTimeToInstant } from "./schedule";
import {
  ASSESSMENT_SLOT_DEFINITIONS,
  ASSESSMENT_TIME_ZONE,
  applyDirectAssessmentTime,
  assessmentAvailabilityIntersection,
  assessmentTimeOptionForInstant,
  assessmentTimeOptionToken,
  normalizeAssessmentTimeOptions,
  parseAssessmentTimeOption,
  type InvitationDraft,
} from "./invitation-contract";

type AvailabilitySide = "parent" | "assessor";
type AvailabilityMode = AvailabilitySide | "direct";

function initialAvailabilityMode(
  value: InvitationDraft,
  editableSide: "both" | AvailabilitySide,
): AvailabilityMode {
  if (editableSide === "assessor") return "assessor";
  if (editableSide === "both"
      && value.assessorId
      && (value.state === "awaiting_parent" || value.state === "confirmed")) {
    return "direct";
  }
  return "parent";
}

const EXPIRED_SLOT_STYLE = {
  backgroundColor: "color-mix(in srgb, var(--paper) 84%, var(--line))",
  backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--line) 42%, transparent) 5px 6px)",
};

function dayFromOption(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = parseAssessmentTimeOption(value);
  if (!parsed) return null;
  const [year, month, day] = parsed.dayKey.split("-").map(Number);
  return zonedDateTimeToInstant({ year, month: month - 1, day }, ASSESSMENT_TIME_ZONE);
}

export function AssessmentAvailabilityGrid({
  value,
  locale,
  disabled = false,
  editableSide = "both",
  onChange,
}: {
  value: InvitationDraft;
  locale: string;
  disabled?: boolean;
  editableSide?: "both" | AvailabilitySide;
  onChange: (value: InvitationDraft) => void;
}) {
  const t = useTranslations("school.invitations");
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<AvailabilityMode>(() => initialAvailabilityMode(value, editableSide));
  const initialAnchor = value.scheduledAt
    ? new Date(value.scheduledAt)
    : dayFromOption(value.parentTimeOptions[0] ?? value.assessorTimeOptions[0]) ?? new Date();
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(initialAnchor, ASSESSMENT_TIME_ZONE));
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addCalendarDays(weekAnchor, index, ASSESSMENT_TIME_ZONE)),
    [weekAnchor],
  );
  const weekdayFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: ASSESSMENT_TIME_ZONE,
  }), [locale]);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    timeZone: ASSESSMENT_TIME_ZONE,
  }), [locale]);
  const candidateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: ASSESSMENT_TIME_ZONE,
  }), [locale]);
  const parentSet = useMemo(() => new Set(value.parentTimeOptions), [value.parentTimeOptions]);
  const assessorSet = useMemo(() => new Set(value.assessorTimeOptions), [value.assessorTimeOptions]);
  const intersection = useMemo(() => assessmentAvailabilityIntersection(
    value.parentTimeOptions,
    value.assessorTimeOptions,
  ), [value.assessorTimeOptions, value.parentTimeOptions]);
  const intersectionSet = useMemo(() => new Set(intersection), [intersection]);
  const weekLabel = `${dateFormatter.format(days[0])} — ${dateFormatter.format(days[6])}`;
  const now = new Date();
  const todayKey = assessmentTimeOptionToken(now, ASSESSMENT_SLOT_DEFINITIONS[0].key).slice(0, 10);

  const isoFor = (day: Date, hour: number, minute: number) => {
    const parts = zonedDateParts(day, ASSESSMENT_TIME_ZONE);
    return zonedDateTimeToInstant({ year: parts.year, month: parts.month, day: parts.day, hour, minute }, ASSESSMENT_TIME_ZONE).toISOString();
  };
  const toggleSlot = (slot: string) => {
    if (side === "direct") {
      const targetState = value.state === "awaiting_parent" ? "awaiting_parent" : "confirmed";
      const next = applyDirectAssessmentTime(value, slot, targetState);
      if (!next) return;
      onChange(next);
      setOpen(false);
      return;
    }
    const key = side === "parent" ? "parentTimeOptions" : "assessorTimeOptions";
    const current = new Set(value[key]);
    if (current.has(slot)) current.delete(slot);
    else current.add(slot);
    const nextOptions = normalizeAssessmentTimeOptions([...current]);
    const next = { ...value, [key]: nextOptions };
    const nextIntersection = assessmentAvailabilityIntersection(next.parentTimeOptions, next.assessorTimeOptions);
    const scheduledOption = next.scheduledAt ? assessmentTimeOptionForInstant(next.scheduledAt) : null;
    onChange({
      ...next,
      scheduledAt: scheduledOption && nextIntersection.includes(scheduledOption) ? next.scheduledAt : null,
    });
  };
  const triggerSummary = value.scheduledAt
    ? t("availabilityConfirmed", { time: candidateFormatter.format(new Date(value.scheduledAt)) })
    : value.parentTimeOptions.length + value.assessorTimeOptions.length > 0
      ? t("availabilityCounts", {
          parent: value.parentTimeOptions.length,
          assessor: value.assessorTimeOptions.length,
          overlap: intersection.length,
        })
      : t("availabilityEmpty");
  const choosingScheduledTime = value.state === "awaiting_parent" || value.state === "confirmed";
  const scheduledTimeNeedsAssessor = editableSide === "both" && choosingScheduledTime && !value.assessorId;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="secondary"
        className="h-10 w-full justify-start gap-2 rounded-xl px-3 text-left"
        disabled={disabled || scheduledTimeNeedsAssessor}
        title={scheduledTimeNeedsAssessor ? t("availabilityDirectNeedsAssessor") : undefined}
        onClick={() => {
          setSide(initialAvailabilityMode(value, editableSide));
          setOpen(true);
        }}
      >
        <CalendarDays className="size-4 shrink-0 text-moon-deep" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-ink">
            {scheduledTimeNeedsAssessor
              ? t("availabilityDirectNeedsAssessor")
              : choosingScheduledTime
                ? t("availabilityChooseScheduled")
                : t("availabilityOpen")}
          </span>
          <span className="block truncate text-[10px] font-normal text-muted">{triggerSummary}</span>
        </span>
      </Button>
      <DialogContent className="max-w-[min(62rem,calc(100vw-2rem))] gap-3 p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>{t("availabilityTitle")}</DialogTitle>
          <DialogDescription>{t("availabilityDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-line py-2">
          <div className="inline-flex rounded-xl bg-paper/70 p-1" role="group" aria-label={t("availabilityEditSide")}>
            {editableSide !== "assessor" ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn("h-8 rounded-lg px-3 text-xs", side === "parent" && "bg-moon/35 text-ink shadow-sm")}
                aria-pressed={side === "parent"}
                onClick={() => setSide("parent")}
              >
                {side === "parent" ? <Check className="size-3.5" /> : null}
                {t("availabilityParentSide")}
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">{value.parentTimeOptions.length}</Badge>
              </Button>
            ) : null}
            {editableSide !== "parent" ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn("h-8 rounded-lg px-3 text-xs", side === "assessor" && "bg-leaf/35 text-ink shadow-sm")}
                aria-pressed={side === "assessor"}
                onClick={() => setSide("assessor")}
              >
                {side === "assessor" ? <Check className="size-3.5" /> : null}
                {t("availabilityAssessorSide")}
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">{value.assessorTimeOptions.length}</Badge>
              </Button>
            ) : null}
            {editableSide === "both" && choosingScheduledTime ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn("h-8 rounded-lg px-3 text-xs", side === "direct" && "bg-rose/15 text-ink shadow-sm")}
                aria-pressed={side === "direct"}
                disabled={!value.assessorId}
                title={!value.assessorId ? t("availabilityDirectNeedsAssessor") : undefined}
                onClick={() => setSide("direct")}
              >
                {side === "direct" ? <Check className="size-3.5" /> : null}
                {t("availabilityScheduledSide")}
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" size="sm" variant="ghost" className="size-8 p-0" aria-label={t("availabilityPreviousWeek")} onClick={() => setWeekAnchor((current) => addCalendarDays(current, -7, ASSESSMENT_TIME_ZONE))}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-32 text-center text-xs font-medium text-ink">{weekLabel}</span>
            <Button type="button" size="sm" variant="ghost" className="size-8 p-0" aria-label={t("availabilityNextWeek")} onClick={() => setWeekAnchor((current) => addCalendarDays(current, 7, ASSESSMENT_TIME_ZONE))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        {side === "direct" ? (
          <p className="border-l-2 border-rose pl-3 text-[11px] leading-5 text-ink" role="status">
            {t(value.state === "confirmed" ? "availabilityConfirmedModeHint" : "availabilityCandidateModeHint")}
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-xl border border-line">
          <div className="grid min-w-[48rem] grid-cols-[5.5rem_repeat(7,minmax(5.5rem,1fr))] bg-card">
            <div className="sticky left-0 z-20 flex min-h-12 items-center justify-center border-b border-r border-line bg-card text-[10px] text-muted">
              {t("availabilityTimeColumn")}
            </div>
            {days.map((day) => {
              const dayExpired = assessmentTimeOptionToken(day, ASSESSMENT_SLOT_DEFINITIONS[0].key).slice(0, 10) < todayKey;
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center border-b border-r border-line last:border-r-0",
                    dayExpired ? "bg-paper text-muted/50" : "bg-card",
                  )}
                >
                  <span className={cn("text-[10px]", dayExpired ? "text-muted/45" : "text-muted")}>{weekdayFormatter.format(day)}</span>
                  <span className={cn("text-xs font-medium", dayExpired ? "text-muted/55" : "text-ink")}>{dateFormatter.format(day)}</span>
                </div>
              );
            })}
            {ASSESSMENT_SLOT_DEFINITIONS.flatMap(({ key, hour, minute }) => {
              const label = hour === null || minute === null
                ? t("availabilityAfterSchoolSlot")
                : key;
              return [
                <div key={`${label}-label`} className="sticky left-0 z-10 flex min-h-11 items-center justify-center border-b border-r border-line bg-card px-1 text-[10px] font-medium text-muted last:border-b-0">
                  {label}
                </div>,
                ...days.map((day) => {
                  const option = assessmentTimeOptionToken(day, key);
                  const instant = hour === null || minute === null ? null : isoFor(day, hour, minute);
                  const parent = parentSet.has(option);
                  const assessor = assessorSet.has(option);
                  const overlap = intersectionSet.has(option);
                  const selected = Boolean(instant && value.scheduledAt === instant);
                  const expired = instant
                    ? new Date(instant).getTime() < now.getTime()
                    : assessmentTimeOptionToken(day, key).slice(0, 10) < todayKey;
                  const unavailable = expired && !parent && !assessor && !selected;
                  const directUnavailable = side === "direct" && !instant;
                  const sideLabel = side === "direct"
                    ? t("availabilityScheduledShort")
                    : t(`availability${side === "parent" ? "Parent" : "Assessor"}Short`);
                  return (
                    <button
                      key={option}
                      type="button"
                      className={cn(
                        "relative min-h-11 border-b border-r border-line text-[10px] transition-colors last:border-r-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-crater",
                        !expired && !parent && !assessor && "bg-card hover:bg-moon/20",
                        parent && !assessor && "bg-moon/20 hover:bg-moon/30",
                        assessor && !parent && "bg-leaf/20 hover:bg-leaf/30",
                        overlap && "bg-rose/15 hover:bg-rose/25",
                        selected && "bg-rose text-white hover:bg-rose",
                        (expired || directUnavailable) && "cursor-not-allowed",
                        directUnavailable && "opacity-45",
                        unavailable && "text-muted/35",
                      )}
                      style={unavailable ? EXPIRED_SLOT_STYLE : undefined}
                      disabled={disabled || expired || directUnavailable}
                      aria-pressed={side === "direct" ? selected : side === "parent" ? parent : assessor}
                      aria-label={t("availabilityCellLabel", { date: `${dateFormatter.format(day)} ${label}`, side: sideLabel })}
                      onClick={() => toggleSlot(option)}
                    >
                      {selected ? <Check className="mx-auto size-4" /> : (
                        <span className="inline-flex items-center gap-1">
                          {parent ? <span className="font-medium text-moon-deep">{t("availabilityParentShort")}</span> : null}
                          {assessor ? <span className="font-medium text-leaf-deep">{t("availabilityAssessorShort")}</span> : null}
                          {!parent && !assessor && !expired ? <span className="size-1.5 rounded-full bg-crater/35" /> : null}
                          {unavailable ? <span className="text-muted/30">—</span> : null}
                        </span>
                      )}
                    </button>
                  );
                }),
              ];
            })}
          </div>
        </div>

        <div className="grid gap-2 rounded-xl bg-paper/60 p-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <div>
            <p className="text-xs font-medium text-ink">{t("availabilityOverlapTitle", { count: intersection.length })}</p>
            <p className="mt-1 text-[10px] leading-4 text-muted">{t("availabilityOverlapHint")}</p>
          </div>
          <div className="flex min-h-8 flex-wrap items-center gap-1.5">
            {intersection.length > 0 ? intersection.map((option) => {
              const parsed = parseAssessmentTimeOption(option);
              const definition = ASSESSMENT_SLOT_DEFINITIONS.find((slot) => slot.key === parsed?.slotKey);
              if (!parsed || !definition) return null;
              const [year, month, day] = parsed.dayKey.split("-").map(Number);
              const instant = definition.hour === null || definition.minute === null
                ? null
                : zonedDateTimeToInstant({ year, month: month - 1, day, hour: definition.hour, minute: definition.minute }, ASSESSMENT_TIME_ZONE).toISOString();
              const selected = Boolean(instant && value.scheduledAt === instant);
              const display = instant
                ? candidateFormatter.format(new Date(instant))
                : `${dateFormatter.format(zonedDateTimeToInstant({ year, month: month - 1, day }, ASSESSMENT_TIME_ZONE))} · ${t("availabilityAfterSchoolSlot")}`;
              return (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={selected ? "primary" : "secondary"}
                  className="h-8 rounded-lg px-2.5 text-[11px]"
                  disabled={editableSide === "assessor" || !instant}
                  title={!instant ? t("availabilityRangeNeedsDetail") : undefined}
                  onClick={() => { if (instant) onChange({ ...value, scheduledAt: selected ? null : instant }); }}
                >
                  {selected ? <Check className="size-3.5" /> : null}
                  {display}
                  {!instant ? ` · ${t("availabilityRangeNeedsDetail")}` : ""}
                </Button>
              );
            }) : <span className="text-[11px] text-muted">{t("availabilityNoOverlap")}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted">
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-moon/40" />{t("availabilityParentLegend")}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-leaf/40" />{t("availabilityAssessorLegend")}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-rose/35" />{t("availabilityOverlapLegend")}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm border border-line" style={EXPIRED_SLOT_STYLE} />{t("availabilityExpiredLegend")}</span>
        </div>
        <DialogFooter>
          <Button type="button" size="sm" onClick={() => setOpen(false)}>{t("availabilityDone")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
