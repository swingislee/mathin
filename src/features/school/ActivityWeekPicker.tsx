"use client";

import { Check, ChevronLeft, ChevronRight, CircleHelp } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { activityGradeFit, activityInitialWeek, activityWeekCell } from "./activity-grade-contract";
import { ASSESSMENT_TIME_ZONE, type InvitationActivityOption } from "./invitation-contract";
import { addCalendarDays, calendarDayKey, startOfWeek } from "./schedule";

/** 内嵌轻课表：整张场次卡可选；只浏览不会写入邀约，也不会默认确认家长。 */
export function ActivityWeekPicker({ activities, gradeHint, selectedId, locale, disabled, onSelect, onChooseAssessment }: {
  activities: InvitationActivityOption[]; gradeHint?: number | null; selectedId: string | null;
  locale: string; disabled?: boolean; onSelect: (activity: InvitationActivityOption) => void;
  onChooseAssessment?: () => void;
}) {
  const t = useTranslations("school.activityWeek");
  const [now] = useState(() => new Date());
  const thisWeek = startOfWeek(now, ASSESSMENT_TIME_ZONE);
  const selected = activities.find((activity) => activity.id === selectedId);
  const [anchor, setAnchor] = useState(() => activityInitialWeek(activities, gradeHint, selectedId, now));
  const [showUnknown, setShowUnknown] = useState(false);
  const days = Array.from({ length: 7 }, (_, index) => addCalendarDays(anchor, index, ASSESSMENT_TIME_ZONE));
  const startKey = calendarDayKey(days[0], ASSESSMENT_TIME_ZONE);
  const endKey = calendarDayKey(days[6], ASSESSMENT_TIME_ZONE);
  const dateFormat = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", timeZone: ASSESSMENT_TIME_ZONE });
  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: ASSESSMENT_TIME_ZONE });
  const timeFormat = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ASSESSMENT_TIME_ZONE });
  const upcoming = activities.filter((activity) => new Date(activity.scheduledAt) >= now || activity.id === selectedId);
  const eligible = upcoming.filter((activity) => activityGradeFit(activity.targetGrades, gradeHint) === "match"
    || (showUnknown && activityGradeFit(activity.targetGrades, gradeHint) === "unknown") || activity.id === selectedId);
  const inWeek = eligible.filter((activity) => { const { day } = activityWeekCell(activity); return day >= startKey && day <= endKey; });
  const byStartTime = (a: InvitationActivityOption, b: InvitationActivityOption) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  const nextAvailable = eligible.filter((activity) => activityWeekCell(activity).day > endKey).sort(byStartTime)[0];
  const hasUnknown = upcoming.some((activity) => activityGradeFit(activity.targetGrades, gradeHint) === "unknown");
  const visiblePeriods = (["morning", "afternoon", "evening"] as const).filter((period) => inWeek.some((activity) => activityWeekCell(activity).period === period));
  return <section data-activity-week className="min-w-0 space-y-2" aria-label={t("title")}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <p className="text-xs text-muted">{gradeHint != null ? t("gradeScope", { grade: gradeHint }) : t("studentGradeUnknown")}</p>
        <TooltipProvider delayDuration={200}><Tooltip>
          <TooltipTrigger asChild><Button type="button" variant="ghost" size="sm" className="size-6 shrink-0 p-0 text-muted" aria-label={t("selectionHelp")}>
            <CircleHelp className="size-3.5" aria-hidden />
          </Button></TooltipTrigger>
          <TooltipContent className="max-w-72 leading-5">{selectedId ? t("selectionDraft") : t("browseHint")}</TooltipContent>
        </Tooltip></TooltipProvider>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="sm" className="size-7 rounded-sm p-0" aria-label={t("previousWeek")}
          disabled={anchor <= thisWeek} onClick={() => setAnchor(addCalendarDays(anchor, -7, ASSESSMENT_TIME_ZONE))}><ChevronLeft className="size-4" /></Button>
        <span className="min-w-24 text-center text-xs font-medium tabular-nums" aria-live="polite">{dateFormat.format(days[0])} – {dateFormat.format(days[6])}</span>
        <Button type="button" variant="ghost" size="sm" className="size-7 rounded-sm p-0" aria-label={t("nextWeek")}
          onClick={() => setAnchor(addCalendarDays(anchor, 7, ASSESSMENT_TIME_ZONE))}><ChevronRight className="size-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 rounded-md px-2 text-xs" onClick={() => setAnchor(thisWeek)}>{t("thisWeek")}</Button>
      </div>
    </div>
    {hasUnknown ? <label className="flex w-fit cursor-pointer items-center gap-2 text-[11px] text-muted">
      <Checkbox checked={showUnknown} onCheckedChange={(checked) => setShowUnknown(checked === true)} />{t("showUnknown")}
    </label> : null}
    {inWeek.length ? <div className="min-w-0 overflow-x-auto">
      <div role="table" aria-label={t("title")} className="min-w-[40rem] text-xs">
        <div role="row" className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] border-b border-line">
          <span role="columnheader"><span className="sr-only">{t("period")}</span></span>
          {days.map((day) => <div role="columnheader" key={day.toISOString()} className="px-1 py-2 text-center">
            {weekdayFormat.format(day)}<span className="ml-1 text-muted">{dateFormat.format(day)}</span>
          </div>)}
        </div>
        {visiblePeriods.map((period) => <div key={period} role="row" className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] border-b border-line/60">
          <div role="rowheader" className="px-1 pt-3 text-[11px] text-muted">{t(period)}</div>
          {days.map((day) => <div key={day.toISOString()} role="cell" className="min-h-14 space-y-1.5 border-l border-line/60 p-1">
            {inWeek.filter((activity) => { const cell = activityWeekCell(activity); return cell.day === calendarDayKey(day, ASSESSMENT_TIME_ZONE) && cell.period === period; })
              .sort(byStartTime).map((activity) => {
                const fit = activityGradeFit(activity.targetGrades, gradeHint);
                return <button key={activity.id} type="button" disabled={disabled || new Date(activity.scheduledAt) < now}
                  aria-pressed={activity.id === selectedId} onClick={() => onSelect(activity)}
                  className={cn("w-full space-y-1 rounded-md border border-transparent bg-card/80 p-2 text-left text-[11px] leading-4 text-ink transition-colors hover:bg-moon/20 focus-visible:outline-2 focus-visible:outline-[var(--followup-outline)] disabled:opacity-60",
                    activity.id === selectedId && "border-leaf-deep bg-leaf/20")}>
                  <span className="flex flex-wrap items-baseline gap-x-1 tabular-nums">
                    <span className="font-medium">{activity.id === selectedId ? <Check className="mr-1 inline size-3" aria-hidden /> : null}{timeFormat.format(new Date(activity.scheduledAt))}</span>
                    {activity.durationMin ? <span className="text-[10px] text-muted">{t("minutes", { count: activity.durationMin })}</span> : null}
                  </span>
                  <span className="block break-words text-xs leading-5">{activity.title}</span>
                  {activity.location ? <span className="block break-words text-[10px] text-muted">{activity.location}</span> : null}
                  {fit !== "match" ? <span className="block text-rose">{t(fit === "unknown" ? "verifyGrade" : "gradeMismatch")}</span> : null}
                </button>;
              })}
          </div>)}
        </div>)}
      </div>
    </div> : <div data-activity-empty className="space-y-2 py-3 text-xs text-muted">
      <p>{t("emptyWeek")}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {nextAvailable ? <Button type="button" size="sm" variant="ghost" className="h-8 px-0 text-xs underline underline-offset-4"
          onClick={() => setAnchor(startOfWeek(new Date(nextAvailable.scheduledAt), ASSESSMENT_TIME_ZONE))}>{t("nextAvailable")}</Button> : null}
        {onChooseAssessment ? <Button type="button" size="sm" variant="ghost" disabled={disabled} className="h-8 px-0 text-xs underline underline-offset-4"
          onClick={onChooseAssessment}>{t("switchAssessment")}</Button> : null}
        {hasUnknown ? <Link className="underline underline-offset-4" href="/dashboard/activities">{t("configureGrades")}</Link> : null}
      </div>
    </div>}
    {selectedId && !selected ? <p className="text-xs text-muted">{t("selectedUnavailable")}</p> : null}
  </section>;
}
