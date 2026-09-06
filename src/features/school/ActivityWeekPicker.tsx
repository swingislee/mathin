"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { activityGradeFit, activityWeekCell } from "./activity-grade-contract";
import { ASSESSMENT_TIME_ZONE, type InvitationActivityOption } from "./invitation-contract";
import { addCalendarDays, calendarDayKey, startOfWeek } from "./schedule";

/** 内嵌轻课表：整张场次卡可选；只浏览不会写入邀约，也不会默认确认家长。 */
export function ActivityWeekPicker({ activities, gradeHint, selectedId, locale, disabled, onSelect }: {
  activities: InvitationActivityOption[]; gradeHint?: number | null; selectedId: string | null;
  locale: string; disabled?: boolean; onSelect: (activity: InvitationActivityOption) => void;
}) {
  const t = useTranslations("school.activityWeek");
  const [now] = useState(() => new Date());
  const thisWeek = startOfWeek(now, ASSESSMENT_TIME_ZONE);
  const selected = activities.find((activity) => activity.id === selectedId);
  const [anchor, setAnchor] = useState(() => selected ? startOfWeek(new Date(selected.scheduledAt), ASSESSMENT_TIME_ZONE) : thisWeek);
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
  const nextAvailable = eligible.filter((activity) => activityWeekCell(activity).day > endKey).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
  const hasUnknown = upcoming.some((activity) => activityGradeFit(activity.targetGrades, gradeHint) === "unknown");
  return <section data-activity-week className="min-w-0 space-y-2" aria-label={t("title")}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted">{gradeHint != null ? t("gradeScope", { grade: gradeHint }) : t("studentGradeUnknown")}</p>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" className="size-7 rounded-sm p-0" aria-label={t("previousWeek")}
          disabled={anchor <= thisWeek} onClick={() => setAnchor(addCalendarDays(anchor, -7, ASSESSMENT_TIME_ZONE))}><ChevronLeft className="size-4" /></Button>
        <span className="min-w-24 text-center text-xs tabular-nums" aria-live="polite">{dateFormat.format(days[0])} – {dateFormat.format(days[6])}</span>
        <Button type="button" variant="ghost" size="sm" className="size-7 rounded-sm p-0" aria-label={t("nextWeek")}
          onClick={() => setAnchor(addCalendarDays(anchor, 7, ASSESSMENT_TIME_ZONE))}><ChevronRight className="size-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 rounded-md px-2 text-xs" onClick={() => setAnchor(thisWeek)}>{t("thisWeek")}</Button>
      </div>
    </div>
    {hasUnknown ? <label className="flex w-fit cursor-pointer items-center gap-2 text-[11px] text-muted">
      <Checkbox checked={showUnknown} onCheckedChange={(checked) => setShowUnknown(checked === true)} />{t("showUnknown")}
    </label> : null}
    {inWeek.length ? <div className="min-w-0 overflow-x-auto rounded-md border border-line bg-card">
      <div role="table" aria-label={t("title")} className="min-w-[37rem] text-xs">
        <div role="row" className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] border-b border-line bg-moon/15">
          <span role="columnheader"><span className="sr-only">{t("period")}</span></span>
          {days.map((day) => <div role="columnheader" key={day.toISOString()} className="border-l border-line px-1 py-2 text-center">
            {weekdayFormat.format(day)}<span className="ml-1 text-muted">{dateFormat.format(day)}</span>
          </div>)}
        </div>
        {(["morning", "afternoon", "evening"] as const).map((period) => <div key={period} role="row" className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] border-b border-line last:border-b-0">
          <div role="rowheader" className="flex items-center justify-center px-1 text-[11px] text-muted">{t(period)}</div>
          {days.map((day) => <div key={day.toISOString()} role="cell" className="min-h-16 space-y-1 border-l border-line p-1">
            {inWeek.filter((activity) => { const cell = activityWeekCell(activity); return cell.day === calendarDayKey(day, ASSESSMENT_TIME_ZONE) && cell.period === period; })
              .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).map((activity) => {
                const fit = activityGradeFit(activity.targetGrades, gradeHint);
                return <button key={activity.id} type="button" disabled={disabled || new Date(activity.scheduledAt) < now}
                  aria-pressed={activity.id === selectedId} onClick={() => onSelect(activity)}
                  className={cn("w-full space-y-1 rounded-sm border border-line bg-paper p-1.5 text-left text-[11px] leading-4 text-ink transition-colors hover:border-[var(--followup-outline)] focus-visible:outline-2 focus-visible:outline-[var(--followup-outline)] disabled:opacity-60",
                    activity.id === selectedId && "border-leaf-deep bg-leaf/20 ring-1 ring-leaf-deep")}>
                  <span className="block font-medium tabular-nums">{activity.id === selectedId ? <Check className="mr-1 inline size-3" aria-hidden /> : null}{timeFormat.format(new Date(activity.scheduledAt))}</span>
                  <span className="block break-words">{activity.title}</span>
                  {activity.durationMin ? <span className="block text-muted">{t("minutes", { count: activity.durationMin })}</span> : null}
                  {activity.location ? <span className="block break-words text-muted">{activity.location}</span> : null}
                  {fit !== "match" ? <span className="block text-rose">{t(fit === "unknown" ? "verifyGrade" : "gradeMismatch")}</span> : null}
                </button>;
              })}
          </div>)}
        </div>)}
      </div>
    </div> : <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line bg-card px-4 py-5 text-center text-xs text-muted">
      <p>{t("emptyWeek")}</p>
      {nextAvailable ? <Button type="button" size="sm" variant="secondary" className="h-8 rounded-md px-3 text-xs"
        onClick={() => setAnchor(startOfWeek(new Date(nextAvailable.scheduledAt), ASSESSMENT_TIME_ZONE))}>{t("nextAvailable")}</Button> : null}
      {hasUnknown ? <Link className="underline underline-offset-2" href="/dashboard/activities">{t("configureGrades")}</Link> : null}
    </div>}
    {selectedId && !selected ? <p className="text-xs text-muted">{t("selectedUnavailable")}</p> : null}
    <p className="text-[11px] leading-4 text-muted">{selectedId ? t("selectionDraft") : t("browseHint")}</p>
  </section>;
}
