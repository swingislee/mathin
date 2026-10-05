"use client";

import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Flag, Plus } from "lucide-react";
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

export function CalendarCanvas({ anchor, view, items, backgroundItems = items, locale, timeZone, now, loading, schoolWindows = [], teachingCalendar = [], campusId = null, onOpen, onCreate, onCreateMilestone, onResize, onSelectDay }: {
  anchor: string; view: CalendarView; items: CalendarItem[]; locale: string; timeZone: string; now: number; loading?: boolean;
  schoolWindows?: readonly CalendarSchoolWindow[]; teachingCalendar?: readonly TeachingCalendarEntryV2[]; campusId?: string | null;
  backgroundItems?: CalendarItem[];
  onOpen: (item: CalendarItem) => void; onCreate?: (start: Date) => void; onSelectDay: (day: string) => void;
  onCreateMilestone?: (start: Date) => void; onResize?: (item: CalendarItem, startsAt: string, endsAt: string) => Promise<void>;
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
  const placements = laidOutDays.flat();
  const flagMinutes = items.filter(item => item.kind === "milestone").map(item => {
    const parts = zonedDateParts(new Date(item.startsAt), timeZone);
    return parts.hour * 60 + parts.minute;
  });
  const periods = days.flatMap(day => calendarDayContext(day, timeZone, campusId, teachingCalendar, schoolWindows, backgroundItems).periods);
  const firstHour = Math.max(0, Math.min(8, ...placements.map(item => Math.floor(item.fromMinute / 60)), ...flagMinutes.map(minute => Math.floor(minute / 60)), ...periods.map(period => Math.floor(period.from / 60))));
  const lastHour = Math.min(24, Math.max(21, ...placements.map(item => Math.ceil(item.toMinute / 60)), ...flagMinutes.map(minute => Math.ceil((minute + 30) / 60)), ...periods.map(period => Math.ceil(period.to / 60))));
  const hourPixels = 72;
  const height = (lastHour - firstHour) * hourPixels;
  const steps = (lastHour - firstHour) * 2;
  const titleFor = (item: CalendarItem) => [item.title, `${time.format(new Date(item.startsAt))}–${time.format(new Date(item.endsAt))}`, item.subtitle, item.detail, item.state].filter(Boolean).join(" · ");

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
    backgroundItems={backgroundItems} campusId={campusId} schoolWindows={schoolWindows} teachingCalendar={teachingCalendar} onOpen={onOpen} onCreate={onCreate} onCreateMilestone={onCreateMilestone} onSelectDay={onSelectDay} />;

  if (view === "month") return <div className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
    <div className="grid min-h-full min-w-[680px] grid-cols-7" style={{ gridTemplateRows: "36px repeat(6, minmax(104px, 1fr))" }}>
      {days.slice(0, 7).map(day => <div key={day.toISOString()} className="sticky top-0 z-10 border-b border-line bg-paper py-2 text-center text-xs text-muted">{weekday.format(day)}</div>)}
      {days.map(day => {
        const key = calendarDayKey(day, timeZone);
        const parts = zonedDateParts(day, timeZone);
        const entries = calendarItemsForDay(items, day, timeZone);
        const context = calendarDayContext(day, timeZone, campusId, teachingCalendar, schoolWindows, backgroundItems);
        return <div key={key} className={cn("min-w-0 border-b border-r border-line p-1.5", context.closed ? "bg-line/35" : context.periods.length ? "bg-moon/10" : "bg-leaf/5", parts.month !== month && "opacity-60")}>
          <div className="mb-1 flex items-center justify-between">
            <button type="button" aria-label={dateLabel.format(day)} onClick={() => onSelectDay(key)}
              className={cn("flex size-7 items-center justify-center rounded-full text-sm hover:bg-moon/50", key === today && "bg-rose text-white")}>{parts.day}</button>
            <div className="flex">{onCreateMilestone ? <button type="button" disabled={loading} className="flex size-6 items-center justify-center rounded text-rose/70 hover:bg-cheek/30" aria-label={`${dateLabel.format(day)} ${t("kind_milestone")}`} onClick={() => onCreateMilestone(calendarAnchor(key, timeZone))}><Flag className="size-3" /></button> : null}
              {onCreate ? <button type="button" disabled={loading} className="flex size-6 items-center justify-center rounded text-muted hover:bg-moon/40" aria-label={`${dateLabel.format(day)} ${t("create")}`}
                onClick={() => onCreate(dateTimeInputToInstant(`${key}T09:00`, timeZone)!)}><Plus className="size-3.5" /></button> : null}</div>
          </div>
          {context.notices.length ? <p className="mb-1 truncate px-1 text-[10px] text-muted" title={context.notices.map(entry => [entry.campusName, entry.name].filter(Boolean).join(" · ")).join(" / ")}>{context.notices.map(entry => [entry.campusName, entry.name].filter(Boolean).join(" · ")).join(" / ")}</p> : null}
          {entries.slice(0, 3).map(item => <button key={item.id} type="button" title={titleFor(item)} onClick={() => onOpen(item)}
            className={cn("mb-1 flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:brightness-95", CALENDAR_TONES[item.kind].block,
              item.muted && "opacity-50", item.pending && "border border-dashed")}>
            {item.kind === "milestone" ? <Flag className="size-3 shrink-0 fill-rose text-rose" /> : <span className={cn("size-1.5 shrink-0 rounded-full", CALENDAR_TONES[item.kind].dot)} />}
            <span className="truncate">{item.kind !== "strategy" && item.kind !== "milestone" ? time.format(new Date(item.startsAt)) : ""} {item.title}</span>
          </button>)}
          {entries.length > 3 ? <button type="button" className="px-1 text-xs text-muted hover:underline" onClick={() => onSelectDay(key)}>{t("moreEvents", { count: entries.length - 3 })}</button> : null}
        </div>;
      })}
    </div>
  </div>;

  return <div className="relative min-h-0 flex-1 overflow-auto overscroll-contain" aria-busy={loading}>
    <div className={cn("relative grid", view === "week" ? "min-w-[770px]" : "min-w-[280px]")}
      style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
      <div className="sticky top-0 z-20 flex items-end justify-center border-b border-line bg-paper pb-2 text-[10px] text-muted">{t("time")}</div>
      {days.map(day => {
        const key = calendarDayKey(day, timeZone);
        return <div key={key} className="sticky top-0 z-20 relative h-[66px] border-b border-l border-line bg-paper">
          <button type="button" onClick={() => onSelectDay(key)} aria-label={dateLabel.format(day)}
            className={cn("flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted", key === today && "text-rose")}>
            <span>{weekday.format(day)}</span><span className={cn("flex size-7 items-center justify-center rounded-full text-base font-medium text-ink", key === today && "bg-rose text-white")}>{zonedDateParts(day, timeZone).day}</span>
          </button>
          {onCreateMilestone ? <button type="button" disabled={loading} className="absolute right-0.5 top-0.5 flex size-6 items-center justify-center text-rose/70 hover:bg-cheek/30" aria-label={`${dateLabel.format(day)} ${t("kind_milestone")}`} onClick={() => onCreateMilestone(calendarAnchor(key, timeZone))}><Flag className="size-3" /></button> : null}
        </div>;
      })}
      <div className="border-b border-line py-2 text-center text-[10px] text-muted">{t("allDay")}</div>
      {days.map(day => {
        const key = calendarDayKey(day, timeZone);
        const context = calendarDayContext(day, timeZone, campusId, teachingCalendar, schoolWindows, backgroundItems);
        const plans = calendarItemsForDay(items.filter(item => item.kind === "strategy"), day, timeZone);
        return <div key={key} className={cn("min-h-8 min-w-0 border-b border-l border-line px-1 py-1", context.closed && "bg-line/35")}>
          {context.notices.length ? <p className="truncate text-[10px] text-muted" title={context.notices.map(entry => [entry.campusName, entry.name].filter(Boolean).join(" · ")).join(" / ")}>{context.notices.map(entry => [entry.campusName, entry.name].filter(Boolean).join(" · ")).join(" / ")}</p> : null}
          {plans.slice(0, 2).map(item => <button type="button" key={item.id} className={cn("mb-0.5 w-full truncate rounded px-1 py-0.5 text-left text-[10px]", CALENDAR_TONES.strategy.block, item.muted && "opacity-50")} onClick={() => onOpen(item)} title={item.title}>{item.title}</button>)}
          {plans.length > 2 ? <button type="button" className="text-[10px] text-muted" onClick={() => onSelectDay(key)}>{t("moreEvents", { count: plans.length - 2 })}</button> : null}
        </div>;
      })}
      <div className="relative" style={{ height }}>
        {Array.from({ length: lastHour - firstHour }, (_, index) => <div key={index} className="absolute inset-x-0 pr-2 text-right text-[11px] text-muted" style={{ top: index * hourPixels + 3 }}>
          {String(firstHour + index).padStart(2, "0")}:00
        </div>)}
      </div>
      {days.map((day, index) => {
        const key = calendarDayKey(day, timeZone);
        const marker = (clockParts.hour + clockParts.minute / 60 - firstHour) * hourPixels;
        const context = calendarDayContext(day, timeZone, campusId, teachingCalendar, schoolWindows, backgroundItems);
        const flags = items.filter(item => item.kind === "milestone" && calendarDayKey(new Date(item.startsAt), timeZone) === key);
        return <div key={key} className="relative border-l border-line" style={{ height }}>
          {Array.from({ length: steps }, (_, step) => {
            const minutes = firstHour * 60 + step * 30;
            const at = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
            const style = { top: step * hourPixels / 2, height: hourPixels / 2 };
            const className = cn("absolute inset-x-0 border-t border-line/70", step % 2 !== 0 && "border-dashed border-line/40", context.closed ? "bg-line/35" : context.schoolTime(minutes) ? "bg-moon/25" : "bg-leaf/10");
            return onCreate ? <button type="button" key={step} disabled={loading || Boolean(resize)} className={cn(className, "group flex items-center justify-center transition-colors hover:bg-moon/50 focus-visible:bg-moon/40 focus-visible:outline focus-visible:outline-crater")}
              style={style} title={t(context.closed ? "closedDay" : context.schoolTime(minutes) ? "schoolTime" : "parentTime")} aria-label={`${dateLabel.format(day)} ${at} ${t("create")}`} onClick={() => onCreate(dateTimeInputToInstant(`${key}T${at}`, timeZone)!)}>
              <Plus className="size-3.5 text-muted opacity-30 group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
              : <div key={step} className={className} style={style} />;
          })}
          {laidOutDays[index].map(({ item, fromMinute, toMinute, lane, lanes }) => {
            const eventHeight = Math.max(20, (toMinute - fromMinute) / 60 * hourPixels - 2);
            const active = resize?.item.id === item.id;
            const handles = Boolean(item.canResize && onResize && !loading && (!resize || active));
            return <div key={item.id}
              className={cn("group absolute z-[2] rounded-md border-l-[3px] text-left text-xs leading-tight shadow-sm hover:z-10 focus-within:z-10",
                CALENDAR_TONES[item.kind].block, item.muted && "opacity-50", item.pending && "border border-dashed", item.conflict && "ring-1 ring-rose", active && "z-10 ring-2 ring-crater")}
              style={{ top: (fromMinute / 60 - firstHour) * hourPixels + 1, height: eventHeight, left: `calc(${lane * 100 / lanes}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}>
              <button type="button" disabled={Boolean(resize)} onClick={() => onOpen(item)} title={titleFor(item)} aria-label={titleFor(item)} className="h-full w-full overflow-hidden rounded-r-md px-1.5 py-1 text-left hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crater">
                <p className="truncate font-medium">{item.title}</p>
                {eventHeight >= 34 ? <p className="truncate text-[10px]">{time.format(new Date(item.startsAt))}–{time.format(new Date(item.endsAt))}{item.state ? ` · ${item.state}` : ""}</p> : null}
                {eventHeight >= 52 && item.subtitle ? <p className="truncate text-[11px] text-muted">{item.subtitle}</p> : null}
                {eventHeight >= 68 && item.detail ? <p className="truncate text-[10px] text-muted">{item.detail}</p> : null}
              </button>
              {handles ? (["start", "end"] as const).filter(edge => calendarDayKey(new Date(edge === "start" ? item.startsAt : Date.parse(item.endsAt) - 1), timeZone) === key).map(edge => <button type="button" key={edge}
                className={cn("absolute inset-x-1 z-10 flex h-2 touch-none cursor-ns-resize items-center justify-center rounded-sm hover:bg-ink/15 focus-visible:bg-ink/15", edge === "start" ? "top-0" : "bottom-0")}
                aria-label={t(edge === "start" ? "resizeStart" : "resizeEnd")} title={t("resizeHint")}
                onPointerDown={event => beginResize(event, item, key, edge, fromMinute, toMinute)} onPointerMove={moveResize} onPointerUp={event => void finishResize(event)} onPointerCancel={cancelResize}
                onKeyDown={event => { if (event.key === "Escape") cancelResize(); }}>
                <span className={cn("h-0.5 w-5 rounded bg-ink/35 opacity-30 group-hover:opacity-100", active && "opacity-100")} />
              </button>) : null}
            </div>;
          })}
          {onCreateMilestone ? <button type="button" disabled={loading || Boolean(resize)} className="absolute inset-y-0 left-0 z-[3] w-2 cursor-crosshair hover:bg-rose/15" title={t("addMilestoneLine")} aria-label={`${dateLabel.format(day)} ${t("addMilestoneLine")}`}
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect();
              const minute = Math.max(firstHour * 60, Math.min(lastHour * 60 - 30, Math.round((firstHour * 60 + (event.clientY - rect.top) / hourPixels * 60) / 30) * 30));
              const start = calendarTimeAt(key, minute, timeZone);
              if (start) onCreateMilestone(start);
            }} /> : null}
          {flags.map(item => {
            const parts = zonedDateParts(new Date(item.startsAt), timeZone);
            const at = Math.max(0, Math.min(height - 20, (parts.hour + parts.minute / 60 - firstHour) * hourPixels));
            return <div key={item.id} className={cn("pointer-events-none absolute bottom-0 left-1 z-[4] border-l border-dashed border-rose/70", item.muted && "opacity-35")} style={{ top: at }}>
              <button type="button" className="pointer-events-auto absolute -left-1 top-0 flex max-w-[150px] items-center gap-1 whitespace-nowrap bg-paper/90 pr-1 text-xs text-rose-deep hover:underline" title={`${time.format(new Date(item.startsAt))} · ${item.title}`} onClick={() => onOpen(item)}>
                <Flag className="size-3.5 shrink-0 fill-rose text-rose" /><span className="truncate">{item.title}</span>
              </button>
            </div>;
          })}
          {key === today && marker >= 0 && marker < height ? <div className="pointer-events-none absolute inset-x-0 z-[4] border-t border-rose" style={{ top: marker }}>
            <span className="absolute -left-1 -top-1 size-2 rounded-full bg-rose" />
          </div> : null}
        </div>;
      })}
    </div>
  </div>;
}
