"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { calendarDayKey, zonedDateTimeInputValue } from "./schedule";
import { shiftAssessmentSlotDate } from "./assessment-availability-contract";
import { loadAssessmentTeacherCalendarAction } from "./assessment-rules-actions";
import { assessmentRuleError } from "./AssessmentRuleEditor";
import type { AssessmentCalendarSlot, AssessmentRulesWorkspace } from "./assessment-rules-contract";

export function AssessmentTeacherCalendar({ teacherId, workspace, timeZone, now, active, revision }: {
  teacherId: string; workspace: AssessmentRulesWorkspace; timeZone: string; now: number; active: boolean; revision: number;
}) {
  const t = useTranslations("school.assessmentRules"), locale = useLocale();
  const today = calendarDayKey(new Date(now), timeZone);
  const [from, setFrom] = useState(today), [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{ key: string; slots: AssessmentCalendarSlot[]; error: string }>({ key: "", slots: [], error: "" });
  const to = shiftAssessmentSlotDate(from, 13, timeZone);
  const requestKey = `${teacherId}:${from}:${to}:${revision}:${retry}`;
  const pending = active && response.key !== requestKey;
  const error = response.key === requestKey ? response.error : "";
  const data = response.slots;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void loadAssessmentTeacherCalendarAction({ teacherId, from, to }).then(result => {
      if (cancelled) return;
      setResponse({ key: requestKey, slots: result.ok ? result.data : [], error: result.ok ? "" : assessmentRuleError(result.code) });
    }).catch(() => { if (!cancelled) setResponse({ key: requestKey, slots: [], error: "failed" }); });
    return () => { cancelled = true; };
  }, [teacherId, from, to, active, requestKey]);
  const days = Array.from({ length: 14 }, (_, index) => shiftAssessmentSlotDate(from, index, timeZone));
  const time = (instant: string) => zonedDateTimeInputValue(new Date(instant), timeZone).slice(11,16);
  const colors = { calendarAvailable: "bg-leaf/15 text-leaf-deep", calendarBooked: "bg-moon/25 text-ink", calendarUnavailable: "bg-line/40 text-muted" };
  return <div className="space-y-2 py-2" aria-busy={pending}>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button size="sm" variant="ghost" aria-label={t("previousDays")} onClick={() => setFrom(shiftAssessmentSlotDate(from, -14, timeZone))}><ChevronLeft className="size-4" /></Button>
      <span className="tabular-nums">{from} – {to}</span>
      <Button size="sm" variant="ghost" aria-label={t("nextDays")} onClick={() => setFrom(shiftAssessmentSlotDate(from, 14, timeZone))}><ChevronRight className="size-4" /></Button>
      <Button size="sm" variant="ghost" onClick={() => setFrom(today)}>{t("today")}</Button>
      <Button size="sm" variant="ghost" disabled={pending} aria-label={t("refresh")} onClick={() => setRetry(value => value+1)}><RefreshCw className="size-3.5" /></Button>
      {Object.entries(colors).map(([key, color]) => <span key={key} className={`rounded px-1.5 py-0.5 ${color}`}>{t(key)}</span>)}
      {pending && <span role="status" className="text-muted">{t("loadingCalendar")}</span>}
    </div>
    {error ? <p role="alert" className="text-sm text-rose">{t(error)}</p> : <div className="overflow-x-auto">
      <div className={`grid min-w-[42rem] grid-cols-7 border-l border-t border-line ${pending ? "opacity-50" : ""}`}>
        {days.map(day => <div key={day} className="min-h-28 border-b border-r border-line p-1.5">
          <div className={`mb-1 flex items-center justify-between text-xs ${day === today ? "font-semibold text-leaf-deep" : "text-muted"}`}>
            <span>{day.slice(5).replace("-", "/")}</span><span>{new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}</span>
          </div>
          <div className="space-y-1">{data.filter(slot => calendarDayKey(new Date(slot.startsAt), timeZone) === day).map(slot => {
            const state = slot.activeBooked ? "calendarBooked" : slot.enabled && !slot.blocked && Date.parse(slot.startsAt) > now ? "calendarAvailable" : "calendarUnavailable";
            const topics = slot.subjects.map(id => workspace.topics.find(topic => topic.id === id)?.name ?? id).join("、");
            const campus = workspace.campuses.find(item => item.id === slot.campusId)?.name;
            return <div key={slot.id} className={`rounded px-1.5 py-1 text-[11px] ${colors[state]}`} title={`${topics} · ${campus ?? ""} · ${t(state)}`}>
              <div className="whitespace-nowrap tabular-nums">{time(slot.startsAt)}–{time(slot.endsAt)}</div><div className="truncate">{topics}</div>
            </div>;
          })}{!pending && !data.some(slot => calendarDayKey(new Date(slot.startsAt), timeZone) === day) && <span className="text-xs text-muted">—</span>}</div>
        </div>)}
      </div>
    </div>}
  </div>;
}
