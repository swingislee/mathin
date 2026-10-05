"use client";

import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Flag, Repeat2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CALENDAR_TONES, calendarAnchor, calendarDayContext, calendarItemsForDay, calendarRange, calendarTimeAt, layoutCalendarDay, shiftCalendarAnchor,
  type CalendarItem, type CalendarSchoolWindow, type CalendarView,
} from "./calendar-layout";
import { calendarDayKey, dateTimeInputToInstant, zonedDateParts } from "./schedule";
import { CalendarYearView } from "./CalendarYearView";
import type { TeachingCalendarEntryV2 } from "./teaching-calendar";

export function CalendarMiniMonth({ anchor, today, locale, timeZone, onSelect }: {
  anchor: string; today: string; locale: string; timeZone: string; onSelect: (day: string) => void;
}) {
  const t = useTranslations("school.calendar");
  const [browsing, setBrowsing] = useState<string | null>(null);
  const monthAnchor = browsing ?? anchor;
  const month = zonedDateParts(calendarAnchor(monthAnchor, timeZone), timeZone).month;
  const days = calendarRange(monthAnchor, "month", timeZone).days;
  const monthLabel = new Intl.DateTimeFormat(locale, { timeZone, month: "long", year: "numeric" });
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: "narrow" });
  const dayLabel = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "full" });
  return <div>
    <div className="mb-3 flex items-center justify-between gap-1">
      <span className="text-sm font-medium">{monthLabel.format(calendarAnchor(monthAnchor, timeZone))}</span>
      <div className="flex">
        {[-1, 1].map(direction => <Button key={direction} variant="ghost" size="sm" className="size-7 p-0" aria-label={t(direction < 0 ? "previousMonth" : "nextMonth")}
          onClick={() => setBrowsing(shiftCalendarAnchor(monthAnchor, "month", direction, timeZone))}>
          {direction < 0 ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </Button>)}
      </div>
    </div>
    <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
      {days.slice(0, 7).map(day => <span key={day.toISOString()} className="pb-1 text-muted">{weekday.format(day)}</span>)}
      {days.map(day => {
        const key = calendarDayKey(day, timeZone);
        const parts = zonedDateParts(day, timeZone);
        return <button type="button" key={key} aria-label={dayLabel.format(day)} aria-pressed={key === anchor}
          onClick={() => { setBrowsing(null); onSelect(key); }}
          className={cn("mx-auto flex size-7 items-center justify-center rounded-full hover:bg-moon/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crater",
            parts.month !== month && "text-muted/60", key === today && "font-bold text-rose", key === anchor && "bg-moon font-semibold ring-1 ring-crater/50")}>
          {parts.day}
        </button>;
      })}
    </div>
  </div>;
}

interface CalendarResize {
  item: CalendarItem; day: string; edge: "start" | "end"; originY: number; fromMinute: number; toMinute: number;
  startsAt: string; endsAt: string; moved: boolean;
}

export function CalendarCanvas({ anchor, view, items, backgroundItems = items, draft = null, locale, timeZone, now, loading, schoolWindows = [], availableWindows = [], teachingCalendar = [], campusId = null, onOpen, onCreate, onCreateMilestone, onResize, onSelectDay }: {
  anchor: string; view: CalendarView; items: CalendarItem[]; locale: string; timeZone: string; now: number; loading?: boolean;
  schoolWindows?: readonly CalendarSchoolWindow[]; availableWindows?: readonly CalendarSchoolWindow[]; teachingCalendar?: readonly TeachingCalendarEntryV2[]; campusId?: string | null;
  backgroundItems?: CalendarItem[];
  draft?: CalendarItem | null;
  onOpen: (item: CalendarItem) => void; onCreate?: (start: Date, target: HTMLElement) => void; onSelectDay: (day: string) => void;
  onCreateMilestone?: (start: Date, target: HTMLElement) => void; onResize?: (item: CalendarItem, startsAt: string, endsAt: string) => Promise<void>;
}) {
  const t = useTranslations("school.calendar");
  const [clock, setClock] = useState(now);
  const [resize, setResize] = useState<CalendarResize | null>(null);
  const [resizeSaving, setResizeSaving] = useState(false);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const { days } = useMemo(() => calendarRange(anchor, view, timeZone), [anchor, view, timeZone]);
  const today = calendarDayKey(new Date(clock), timeZone);
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short" });
  const dateLabel = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "full" });
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const clockParts = zonedDateParts(new Date(clock), timeZone);
  const month = zonedDateParts(calendarAnchor(anchor, timeZone), timeZone).month;
  const previewItems = resize ? items.map(item => item.id === resize.item.id ? { ...item, startsAt: resize.startsAt, endsAt: resize.endsAt } : item) : items;
  const timedItems = previewItems.filter(item => item.kind !== "strategy" && item.kind !== "milestone");
  const laidOutDays = days.map(day => layoutCalendarDay(timedItems, day, timeZone));
  const draftDays = days.map(day => layoutCalendarDay(draft ? [draft] : [], day, timeZone));
  const placements = [...laidOutDays.flat(), ...draftDays.flat().filter(value => value.item.kind !== "strategy")];
  const flagMinutes = items.filter(item => item.kind === "milestone").map(item => {
    const parts = zonedDateParts(new Date(item.startsAt), timeZone);
    return parts.hour * 60 + parts.minute;
  });
  const periods = days.flatMap(day => calendarDayContext(day, timeZone, campusId, teachingCalendar, schoolWindows, backgroundItems, availableWindows).periods);
  const firstHour = Math.max(0, Math.min(8, ...placements.map(item => Math.floor(item.fromMinute / 60)), ...flagMinutes.map(minute => Math.floor(minute / 60)), ...periods.map(period => Math.floor(period.from / 60))));
  const lastHour = Math.min(24, Math.max(21, ...placements.map(item => Math.ceil(item.toMinute / 60)), ...flagMinutes.map(minute => Math.ceil((minute + 30) / 60)), ...periods.map(period => Math.ceil(period.to / 60))));
  const hourPixels = 72;
  const height = (lastHour - firstHour) * hourPixels;
  const steps = (lastHour - firstHour) * 2;
  const titleFor = (item: CalendarItem) => [item.title, item.seriesId ? t("repeatingEvent") : "", `${time.format(new Date(item.startsAt))}–${time.format(new Date(item.endsAt))}`, item.subtitle, item.detail, item.state].filter(Boolean).join(" · ");

  function beginResize(event: PointerEvent<HTMLButtonElement>, item: CalendarItem, day: string, edge: "start" | "end", fromMinute: number, toMinute: number) {
    if (loading || resize || resizeSaving || !onResize || !item.canResize) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const draft = { item, day, edge, originY: event.clientY, fromMinute, toMinute, startsAt: item.startsAt, endsAt: item.endsAt, moved: false };
    setResize(draft);
  }

  function moveResize(event: PointerEvent<HTMLButtonElement>) {
    const draft = resize;
    if (!draft || resizeSaving) return;
    if (Math.abs(event.clientY - draft.originY) < 9 && !draft.moved) return;
    const delta = (event.clientY - draft.originY) / hourPixels * 60;
    const maxDuration = draft.item.kind === "availability" ? 240 : draft.item.kind === "lesson" ? 600 : 1440;
    const minute = draft.edge === "start"
      ? Math.max(firstHour * 60, Math.ceil((draft.toMinute - maxDuration) / 30) * 30, Math.min(Math.floor((draft.toMinute - 30) / 30) * 30, Math.round((draft.fromMinute + delta) / 30) * 30))
      : Math.min(lastHour * 60, Math.floor((draft.fromMinute + maxDuration) / 30) * 30, Math.max(Math.ceil((draft.fromMinute + 30) / 30) * 30, Math.round((draft.toMinute + delta) / 30) * 30));
    const at = calendarTimeAt(draft.day, minute, timeZone);
    if (!at) return;
    const next = { ...draft, moved: true, startsAt: draft.edge === "start" ? at.toISOString() : draft.item.startsAt, endsAt: draft.edge === "end" ? at.toISOString() : draft.item.endsAt };
    setResize(next);
  }

  async function finishResize(event: PointerEvent<HTMLButtonElement>) {
    const draft = resize;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!draft || resizeSaving) return;
    if (draft.startsAt === draft.item.startsAt && draft.endsAt === draft.item.endsAt) { setResize(null); return; }
    setResizeSaving(true);
    try { await onResize?.(draft.item, draft.startsAt, draft.endsAt); }
    finally { setResizeSaving(false); setResize(null); }
  }

  function cancelResize() { if (!resizeSaving) setResize(null); }

  if (view === "year") return <CalendarYearView anchor={anchor} items={items} locale={locale} timeZone={timeZone} today={today} loading={loading}
    backgroundItems={backgroundItems} draft={draft} campusId={campusId} schoolWindows={schoolWindows} availableWindows={availableWindows} teachingCalendar={teachingCalendar} onOpen={onOpen} onCreate={onCreate} onCreateMilestone={onCreateMilestone} onSelectDay={onSelectDay} />;

  if (view === "month") return <div className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
    <div className="grid min-h-full min-w-[680px] grid-cols-7" style={{ gridTemplateRows: "36px repeat(6, minmax(104px, 1fr))" }}>
      {days.slice(0, 7).map(day => <div key={day.toISOString()} className="sticky top-0 z-10 border-b border-slate-200 bg-white py-2 text-center text-xs text-slate-500">{weekday.format(day)}</div>)}
      {days.map(day => {
        const key = calendarDayKey(day, timeZone);
        const parts = zonedDateParts(day, timeZone);
        const entries = calendarItemsForDay(items, day, timeZone);
        const context = calendarDayContext(day, timeZone, campusId, teachingCalendar, schoolWindows, backgroundItems, availableWindows);
        return <div key={key} className={cn("relative min-w-0 border-b border-r border-slate-200 p-1.5", context.closed ? "bg-slate-50" : "bg-white", parts.month !== month && "text-slate-400")}>
          {onCreate ? <button type="button" className="absolute inset-0 hover:bg-blue-50/40 focus-visible:bg-blue-50" disabled={loading} aria-label={`${dateLabel.format(day)} ${t("create")}`}
            onClick={event => onCreate(dateTimeInputToInstant(`${key}T09:00`, timeZone)!, event.currentTarget)} /> : null}
          <div className="pointer-events-none relative mb-1 flex items-center justify-between">
            <button type="button" aria-label={dateLabel.format(day)} onClick={() => onSelectDay(key)}
              className={cn("pointer-events-auto flex size-7 items-center justify-center rounded-full text-sm hover:bg-blue-100", key === today && "bg-blue-600 text-white")}>{parts.day}</button>
          </div>
          {context.notices.length ? <p className="mb-1 truncate px-1 text-[10px] text-slate-500" title={context.notices.map(entry => [entry.campusName, entry.name].filter(Boolean).join(" · ")).join(" / ")}>{context.notices.map(entry => [entry.campusName, entry.name].filter(Boolean).join(" · ")).join(" / ")}</p> : null}
          {entries.slice(0, 3).map(item => <button key={item.id} type="button" title={titleFor(item)} onClick={() => onOpen(item)}
            className={cn("relative mb-1 flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:brightness-95", CALENDAR_TONES[item.kind].block,
              item.muted && "opacity-50", item.pending && "border border-dashed")}>
            {item.kind === "milestone" ? <Flag className="size-3 shrink-0" /> : item.seriesId ? <Repeat2 className="size-3 shrink-0" /> : null}
            <span className="truncate">{item.kind !== "strategy" && item.kind !== "milestone" ? time.format(new Date(item.startsAt)) : ""} {item.title}</span>
          </button>)}
          {draft && calendarItemsForDay([draft], day, timeZone).length ? <div className="pointer-events-none relative mb-1 truncate rounded border border-blue-500 bg-blue-100 px-1 py-1 text-xs text-blue-700">{draft.title || t("quickTitle")} · {time.format(new Date(draft.startsAt))}</div> : null}
          {entries.length > 3 ? <button type="button" className="relative px-1 text-xs text-slate-500 hover:underline" onClick={() => onSelectDay(key)}>{t("moreEvents", { count: entries.length - 3 })}</button> : null}
        </div>;
      })}
    </div>
  </div>;

  return <div className="relative min-h-0 flex-1 overflow-auto overscroll-contain" aria-busy={loading}>
    <div className={cn("relative grid", view === "week" ? "min-w-[770px]" : "min-w-[280px]")}
      style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
      <div className="sticky top-0 z-20 flex items-end justify-center border-b border-slate-200 bg-white pb-2 text-[10px] text-slate-500">{t("time")}</div>
      {days.map(day => {
        const key = calendarDayKey(day, timeZone);
        return <div key={key} className="sticky top-0 z-20 relative h-[66px] border-b border-l border-slate-200 bg-white">
          <button type="button" onClick={() => onSelectDay(key)} aria-label={dateLabel.format(day)}
            className={cn("flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-slate-500", key === today && "text-blue-600")}>
            <span>{weekday.format(day)}</span><span className={cn("flex size-7 items-center justify-center rounded-full text-base font-medium text-slate-900", key === today && "bg-blue-600 text-white")}>{zonedDateParts(day, timeZone).day}</span>
          </button>
        </div>;
      })}
      <div className="border-b border-slate-200 py-2 text-center text-[10px] text-slate-500">{t("allDay")}</div>
      {days.map(day => {
        const key = calendarDayKey(day, timeZone);
        const context = calendarDayContext(day, timeZone, campusId, teachingCalendar, schoolWindows, backgroundItems, availableWindows);
        const plans = calendarItemsForDay(items.filter(item => item.kind === "strategy"), day, timeZone);
        return <div key={key} className={cn("min-h-8 min-w-0 border-b border-l border-slate-200 px-1 py-1", context.closed && "bg-slate-100")}>
          {context.notices.length ? <p className="truncate text-[10px] text-slate-500" title={context.notices.map(entry => [entry.campusName, entry.name].filter(Boolean).join(" · ")).join(" / ")}>{context.notices.map(entry => [entry.campusName, entry.name].filter(Boolean).join(" · ")).join(" / ")}</p> : null}
          {plans.slice(0, 2).map(item => <button type="button" key={item.id} className={cn("mb-0.5 w-full truncate rounded px-1 py-0.5 text-left text-[10px]", CALENDAR_TONES.strategy.block, item.muted && "opacity-50")} onClick={() => onOpen(item)} title={item.title}>{item.title}</button>)}
          {plans.length > 2 ? <button type="button" className="text-[10px] text-slate-500" onClick={() => onSelectDay(key)}>{t("moreEvents", { count: plans.length - 2 })}</button> : null}
          {draft?.kind === "strategy" && calendarItemsForDay([draft], day, timeZone).length ? <div className="truncate rounded border border-blue-500 bg-blue-100 px-1 py-0.5 text-xs text-blue-700">{draft.title || t("quickTitle")}</div> : null}
        </div>;
      })}
      <div className="relative" style={{ height }}>
        {Array.from({ length: lastHour - firstHour }, (_, index) => <div key={index} className="absolute inset-x-0 pr-2 text-right text-[11px] text-slate-500" style={{ top: index * hourPixels + 3 }}>
          {String(firstHour + index).padStart(2, "0")}:00
        </div>)}
      </div>
      {days.map((day, index) => {
        const key = calendarDayKey(day, timeZone);
        const marker = (clockParts.hour + clockParts.minute / 60 - firstHour) * hourPixels;
        const context = calendarDayContext(day, timeZone, campusId, teachingCalendar, schoolWindows, backgroundItems, availableWindows);
        const flags = items.filter(item => item.kind === "milestone" && calendarDayKey(new Date(item.startsAt), timeZone) === key);
        return <div key={key} className="relative border-l border-slate-200" style={{ height }}>
          {Array.from({ length: steps }, (_, step) => {
            const minutes = firstHour * 60 + step * 30;
            const at = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
            const style = { top: step * hourPixels / 2, height: hourPixels / 2 };
            const className = cn("absolute inset-x-0 border-t border-slate-200", step % 2 !== 0 && "border-slate-100", context.closed ? "bg-slate-100/70" : context.schoolTime(minutes) ? "bg-slate-50" : context.schedulable(minutes) ? "bg-emerald-50/70" : "bg-white");
            return onCreate ? <button type="button" key={step} disabled={loading || Boolean(resize)} className={cn(className, "transition-colors hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:outline focus-visible:outline-blue-500")}
              data-calendar-create style={style} title={context.closed ? t("closedDay") : context.schoolTime(minutes) ? t("schoolTime") : context.schedulable(minutes) ? t("parentTime") : undefined}
              aria-label={`${dateLabel.format(day)} ${at} ${t("create")}`} onClick={event => onCreate(dateTimeInputToInstant(`${key}T${at}`, timeZone)!, event.currentTarget)} />
              : <div key={step} className={className} style={style} />;
          })}
          {laidOutDays[index].map(({ item, fromMinute, toMinute, lane, lanes }) => {
            const eventHeight = Math.max(20, (toMinute - fromMinute) / 60 * hourPixels - 2);
            const active = resize?.item.id === item.id;
            const handles = Boolean(item.canResize && onResize && !loading && (!resize || active));
            return <div key={item.id}
              className={cn("group absolute z-[2] rounded-md border-l-[3px] text-left text-xs leading-tight shadow-sm hover:z-10 focus-within:z-10",
                CALENDAR_TONES[item.kind].block, item.muted && "opacity-50", item.pending && "border border-dashed", item.conflict && "ring-1 ring-rose", active && "z-10 ring-2 ring-blue-500")}
              style={{ top: (fromMinute / 60 - firstHour) * hourPixels + 1, height: eventHeight, left: `calc(${lane * 100 / lanes}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}>
              <button type="button" disabled={Boolean(resize)} onClick={() => onOpen(item)} title={titleFor(item)} aria-label={titleFor(item)} className="h-full w-full overflow-hidden rounded-r-md px-1.5 py-1 text-left hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                <p className="flex items-center gap-1 font-medium">{item.seriesId ? <Repeat2 className="size-3 shrink-0" /> : null}<span className="truncate">{item.title}</span></p>
                {eventHeight >= 34 ? <p className="truncate text-[10px]">{time.format(new Date(item.startsAt))}–{time.format(new Date(item.endsAt))}{item.state ? ` · ${item.state}` : ""}</p> : null}
                {eventHeight >= 52 && item.subtitle ? <p className="truncate text-[11px] opacity-90">{item.subtitle}</p> : null}
                {eventHeight >= 68 && item.detail ? <p className="truncate text-[10px] opacity-90">{item.detail}</p> : null}
              </button>
              {handles ? (["start", "end"] as const).filter(edge => calendarDayKey(new Date(edge === "start" ? item.startsAt : Date.parse(item.endsAt) - 1), timeZone) === key).map(edge => <button type="button" key={edge}
                className={cn("absolute inset-x-0 z-10 h-2 touch-none cursor-ns-resize focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700", edge === "start" ? "-top-0.5" : "-bottom-0.5")}
                aria-label={t(edge === "start" ? "resizeStart" : "resizeEnd")}
                onPointerDown={event => beginResize(event, item, key, edge, fromMinute, toMinute)} onPointerMove={moveResize} onPointerUp={event => void finishResize(event)} onPointerCancel={cancelResize}
                onClick={event => event.stopPropagation()}
                onKeyDown={event => { if (event.key === "Escape") cancelResize(); }} />) : null}
            </div>;
          })}
          {onCreateMilestone ? <button type="button" disabled={loading || Boolean(resize)} className="absolute inset-y-0 left-0 z-[3] w-2 cursor-crosshair hover:bg-rose/15" title={t("addMilestoneLine")} aria-label={`${dateLabel.format(day)} ${t("addMilestoneLine")}`}
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect();
              const minute = Math.max(firstHour * 60, Math.min(lastHour * 60 - 30, Math.round((firstHour * 60 + (event.clientY - rect.top) / hourPixels * 60) / 30) * 30));
              const start = calendarTimeAt(key, minute, timeZone);
              if (start) onCreateMilestone(start, event.currentTarget);
            }} /> : null}
          {flags.map(item => {
            const parts = zonedDateParts(new Date(item.startsAt), timeZone);
            const at = Math.max(0, Math.min(height - 20, (parts.hour + parts.minute / 60 - firstHour) * hourPixels));
            return <div key={item.id} className={cn("pointer-events-none absolute bottom-0 left-1 z-[4] border-l border-dashed border-rose/70", item.muted && "opacity-35")} style={{ top: at }}>
              <button type="button" className="pointer-events-auto absolute -left-1 top-0 flex max-w-[150px] items-center gap-1 whitespace-nowrap bg-white/90 pr-1 text-xs text-rose-deep hover:underline" title={`${time.format(new Date(item.startsAt))} · ${item.title}`} onClick={() => onOpen(item)}>
                <Flag className="size-3.5 shrink-0 fill-rose text-rose" /><span className="truncate">{item.title}</span>
              </button>
            </div>;
          })}
          {draftDays[index].filter(value => value.item.kind !== "strategy").map(({ item, fromMinute, toMinute }) => <div key={item.id}
            className="pointer-events-none absolute inset-x-0.5 z-[15] overflow-hidden rounded border border-blue-500 bg-blue-100/95 px-1.5 py-1 text-xs text-blue-700 ring-1 ring-blue-500/20"
            style={{ top: (fromMinute / 60 - firstHour) * hourPixels + 1, height: Math.max(24, (toMinute - fromMinute) / 60 * hourPixels - 2) }}>
            <span className="font-medium">{item.title || t("quickTitle")}</span><span className="ml-2 text-[10px]">{time.format(new Date(item.startsAt))}–{time.format(new Date(item.endsAt))}</span>
          </div>)}
          {key === today && marker >= 0 && marker < height ? <div className="pointer-events-none absolute inset-x-0 z-[4] border-t border-rose" style={{ top: marker }}>
            <span className="absolute -left-1 -top-1 size-2 rounded-full bg-rose" />
          </div> : null}
        </div>;
      })}
    </div>
  </div>;
}
