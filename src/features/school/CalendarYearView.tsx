"use client";

import { Flag, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { calendarAnchor, calendarDayContext, calendarItemsForDay, calendarRange, CALENDAR_TONES, type CalendarItem, type CalendarSchoolWindow } from "./calendar-layout";
import { calendarDayKey, dateTimeInputToInstant, startOfDay, zonedDateParts, zonedDateTimeToInstant } from "./schedule";
import type { TeachingCalendarEntryV2 } from "./teaching-calendar";

interface Props {
  anchor: string;
  items: CalendarItem[];
  backgroundItems: CalendarItem[];
  locale: string;
  timeZone: string;
  today: string;
  loading?: boolean;
  campusId: string | null;
  schoolWindows: readonly CalendarSchoolWindow[];
  availableWindows: readonly CalendarSchoolWindow[];
  draft: CalendarItem | null;
  teachingCalendar: readonly TeachingCalendarEntryV2[];
  onOpen: (item: CalendarItem) => void;
  onCreate?: (start: Date, target: HTMLElement) => void;
  onCreateMilestone?: (start: Date, target: HTMLElement) => void;
  onSelectDay: (day: string) => void;
}

export function CalendarYearView({ anchor, items, backgroundItems, draft, locale, timeZone, today, loading, campusId, schoolWindows, availableWindows, teachingCalendar, onOpen, onCreate, onCreateMilestone, onSelectDay }: Props) {
  const t = useTranslations("school.calendar");
  const range = calendarRange(anchor, "year", timeZone);
  const { year } = zonedDateParts(range.start, timeZone);
  const duration = range.end.getTime() - range.start.getTime();
  const position = (instant: number) => Math.max(0, Math.min(100, (instant - range.start.getTime()) / duration * 100));
  const plans = items.filter(item => item.kind === "strategy" && Date.parse(item.startsAt) < range.end.getTime() && Date.parse(item.endsAt) > range.start.getTime());
  const milestones = items.filter(item => item.kind === "milestone" && !item.muted && Date.parse(item.startsAt) >= range.start.getTime() && Date.parse(item.startsAt) < range.end.getTime());
  const monthLabel = new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "short" });
  const dateLabel = new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric" });
  const fullDate = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "full" });
  const weekdayLabel = new Intl.DateTimeFormat(locale, { timeZone, weekday: "narrow" });
  const months = Array.from({ length: 12 }, (_, month) => zonedDateTimeToInstant({ year, month: month + 6, day: 1, hour: 12 }, timeZone));

  return <div className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
    <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-3">
      <h2 className="text-sm font-medium">{t("annualPlanning", { year, nextYear: year + 1 })}</h2>
      {onCreate ? <button type="button" disabled={loading} className="flex items-center gap-1.5 text-xs hover:text-blue-600" onClick={event => onCreate(range.start, event.currentTarget)}><Plus className="size-3.5" />{t("kind_strategy")}</button> : null}
    </div>
    <div className="overflow-x-auto border-b border-slate-200">
      <div className="min-w-[980px] px-3 pb-4 pt-2">
        <div className="relative ml-40">
          <div className="relative h-9 border-b border-slate-200">
            {months.map((month, index) => <span key={index} className="absolute inset-y-0 flex items-center border-l border-slate-200 pl-2 text-xs text-slate-500" style={{ left: `${position(startOfDay(month, timeZone).getTime())}%` }}>
              {monthLabel.format(month)}
            </span>)}
          </div>
          <div className={cn("relative h-[72px] border-b border-slate-200", onCreateMilestone && "cursor-crosshair hover:bg-cheek/10")} role={onCreateMilestone ? "button" : undefined} tabIndex={onCreateMilestone ? 0 : undefined}
            aria-label={t("addMilestoneLine")} title={t("addMilestoneLine")}
            onClick={event => {
              if (!onCreateMilestone || loading) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const fraction = Math.max(0, Math.min(0.999, (event.clientX - rect.left) / rect.width));
              const day = range.days[Math.floor(fraction * range.days.length)];
              onCreateMilestone(dateTimeInputToInstant(`${calendarDayKey(day, timeZone)}T12:00`, timeZone)!, event.currentTarget);
            }}
            onKeyDown={event => { if (onCreateMilestone && !loading && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onCreateMilestone(calendarAnchor(anchor, timeZone), event.currentTarget); } }}>
            {!milestones.length ? <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">{t("milestoneRailHint")}</span> : null}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-9 z-[3]" style={{ height: 72 + Math.max(1, plans.length) * 48 }}>
            {milestones.map((item, index) => <div key={item.id} className="absolute inset-y-0 border-l border-dashed border-rose/75" style={{ left: `${position(Date.parse(item.startsAt))}%` }}>
              <button type="button" className="pointer-events-auto absolute left-0 flex max-w-36 items-center gap-1 whitespace-nowrap bg-white/90 pr-1 text-xs text-rose-deep hover:underline"
                style={{ top: index % 2 ? 34 : 6 }} title={`${fullDate.format(new Date(item.startsAt))} · ${item.title}`} onClick={() => onOpen(item)}>
                <Flag className="size-3.5 shrink-0 fill-rose text-rose" /><span className="truncate">{item.title}</span>
              </button>
            </div>)}
          </div>
        </div>
        {plans.length ? plans.map(item => {
          const start = position(Date.parse(item.startsAt));
          const end = position(Date.parse(item.endsAt));
          return <div key={item.id} className="flex h-12 items-center border-b border-slate-200/50">
            <button type="button" className="w-40 shrink-0 truncate pr-3 text-left text-xs font-medium hover:text-rose" onClick={() => onOpen(item)} title={item.title}>{item.title}</button>
            <div className="relative h-full flex-1">
              <button type="button" className={cn("absolute top-2 flex h-8 items-center overflow-hidden rounded border-l-[3px] px-2 text-left text-xs hover:brightness-95", CALENDAR_TONES.strategy.block, item.muted && "opacity-45")}
                style={{ left: `${start}%`, width: `${Math.max(0.7, end - start)}%` }} onClick={() => onOpen(item)} title={`${item.title} · ${dateLabel.format(new Date(item.startsAt))}–${dateLabel.format(new Date(item.endsAt))}`}>
                <span className="truncate">{item.subtitle || item.title}</span>
              </button>
            </div>
          </div>;
        }) : <p className="ml-40 flex h-12 items-center justify-center text-xs text-slate-500">{t("noAnnualPlans")}</p>}
        {draft ? <div className="relative ml-40 h-10"><div className="absolute top-1 truncate rounded border border-blue-500 bg-blue-100 px-2 py-1 text-xs text-blue-700"
          style={{ left: `${position(Date.parse(draft.startsAt))}%`, width: `${Math.max(1, position(Date.parse(draft.endsAt)) - position(Date.parse(draft.startsAt)))}%` }}>{draft.title || t("quickTitle")}</div></div> : null}
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
      {months.map((month, monthIndex) => {
        const key = calendarDayKey(month, timeZone);
        const days = calendarRange(key, "month", timeZone).days;
        return <section key={monthIndex} className="border-b border-r border-slate-200 px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">{monthLabel.format(month)}</h3>
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {days.slice(0, 7).map(day => <span key={day.toISOString()} className="pb-1 text-center text-[10px] text-slate-500">{weekdayLabel.format(day)}</span>)}
            {days.map(day => {
              const dayKey = calendarDayKey(day, timeZone);
              const parts = zonedDateParts(day, timeZone);
              const context = calendarDayContext(day, timeZone, campusId, teachingCalendar, schoolWindows, backgroundItems, availableWindows);
              const entries = calendarItemsForDay(items, day, timeZone);
              const flags = entries.filter(item => item.kind === "milestone" && !item.muted);
              return <button type="button" key={dayKey} onClick={() => onSelectDay(dayKey)} title={[fullDate.format(day), ...context.notices.map(entry => [entry.campusName, entry.name].filter(Boolean).join(" · ")), ...flags.map(item => item.title)].filter(Boolean).join(" · ")}
                className={cn("relative flex h-10 flex-col items-center justify-center rounded text-xs hover:bg-blue-50", parts.month !== zonedDateParts(month, timeZone).month && "opacity-30", context.closed && "bg-slate-100 text-slate-500", dayKey === today && "bg-blue-600 font-bold text-white hover:bg-blue-700")}>
                <span>{parts.day}</span>
                {flags.length ? <Flag className="absolute right-0 top-0 size-2.5 fill-rose text-rose" /> : null}
                <span className="flex h-1 items-center gap-0.5">{entries.filter(item => item.kind !== "milestone").slice(0, 3).map(item => <span key={item.id} className={cn("size-1 rounded-full", CALENDAR_TONES[item.kind].dot)} />)}</span>
              </button>;
            })}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
