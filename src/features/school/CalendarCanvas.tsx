"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CALENDAR_TONES, calendarAnchor, calendarItemsForDay, calendarRange, layoutCalendarDay, shiftCalendarAnchor,
  type CalendarItem, type CalendarView,
} from "./calendar-layout";
import { calendarDayKey, dateTimeInputToInstant, zonedDateParts } from "./schedule";

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

export function CalendarCanvas({ anchor, view, items, locale, timeZone, now, loading, onOpen, onCreate, onSelectDay }: {
  anchor: string; view: CalendarView; items: CalendarItem[]; locale: string; timeZone: string; now: number; loading?: boolean;
  onOpen: (item: CalendarItem) => void; onCreate?: (start: Date) => void; onSelectDay: (day: string) => void;
}) {
  const t = useTranslations("school.calendar");
  const [clock, setClock] = useState(now);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const { days } = useMemo(() => calendarRange(anchor, view, timeZone), [anchor, view, timeZone]);
  const today = calendarDayKey(new Date(clock), timeZone);
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short" });
  const dateLabel = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "full" });
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const clockParts = zonedDateParts(new Date(clock), timeZone);
  const month = zonedDateParts(calendarAnchor(anchor, timeZone), timeZone).month;
  const laidOutDays = days.map(day => layoutCalendarDay(items, day, timeZone));
  const placements = laidOutDays.flat();
  const firstHour = Math.max(0, Math.min(8, ...placements.map(item => Math.floor(item.fromMinute / 60))));
  const lastHour = Math.min(24, Math.max(21, ...placements.map(item => Math.ceil(item.toMinute / 60))));
  const hourPixels = 72;
  const height = (lastHour - firstHour) * hourPixels;
  const steps = (lastHour - firstHour) * 2;
  const titleFor = (item: CalendarItem) => [item.title, `${time.format(new Date(item.startsAt))}–${time.format(new Date(item.endsAt))}`, item.subtitle, item.detail, item.state].filter(Boolean).join(" · ");

  if (view === "month") return <div className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
    <div className="grid min-h-full min-w-[680px] grid-cols-7" style={{ gridTemplateRows: "36px repeat(6, minmax(104px, 1fr))" }}>
      {days.slice(0, 7).map(day => <div key={day.toISOString()} className="sticky top-0 z-10 border-b border-line bg-paper py-2 text-center text-xs text-muted">{weekday.format(day)}</div>)}
      {days.map(day => {
        const key = calendarDayKey(day, timeZone);
        const parts = zonedDateParts(day, timeZone);
        const entries = calendarItemsForDay(items, day, timeZone);
        return <div key={key} className={cn("min-w-0 border-b border-r border-line p-1.5", parts.month !== month && "bg-line/10")}>
          <div className="mb-1 flex items-center justify-between">
            <button type="button" aria-label={dateLabel.format(day)} onClick={() => onSelectDay(key)}
              className={cn("flex size-7 items-center justify-center rounded-full text-sm hover:bg-moon/50", key === today && "bg-rose text-white")}>{parts.day}</button>
            {onCreate ? <button type="button" className="size-7 rounded text-lg text-muted hover:bg-moon/40" aria-label={`${dateLabel.format(day)} ${t("create")}`}
              onClick={() => onCreate(dateTimeInputToInstant(`${key}T09:00`, timeZone)!)}>+</button> : null}
          </div>
          {entries.slice(0, 3).map(item => <button key={item.id} type="button" title={titleFor(item)} onClick={() => onOpen(item)}
            className={cn("mb-1 flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:brightness-95", CALENDAR_TONES[item.kind].block,
              item.muted && "opacity-50", item.pending && "border border-dashed")}>
            <span className={cn("size-1.5 shrink-0 rounded-full", CALENDAR_TONES[item.kind].dot)} />
            <span className="truncate">{time.format(new Date(item.startsAt))} {item.title}</span>
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
        return <button type="button" key={key} onClick={() => onSelectDay(key)} aria-label={dateLabel.format(day)}
          className={cn("sticky top-0 z-20 flex h-[66px] flex-col items-center justify-center gap-1 border-b border-l border-line bg-paper text-xs text-muted", key === today && "text-rose")}>
          <span>{weekday.format(day)}</span><span className={cn("flex size-7 items-center justify-center rounded-full text-base font-medium text-ink", key === today && "bg-rose text-white")}>{zonedDateParts(day, timeZone).day}</span>
        </button>;
      })}
      <div className="relative" style={{ height }}>
        {Array.from({ length: lastHour - firstHour }, (_, index) => <div key={index} className="absolute inset-x-0 pr-2 text-right text-[11px] text-muted" style={{ top: index * hourPixels + 3 }}>
          {String(firstHour + index).padStart(2, "0")}:00
        </div>)}
      </div>
      {days.map((day, index) => {
        const key = calendarDayKey(day, timeZone);
        const marker = (clockParts.hour + clockParts.minute / 60 - firstHour) * hourPixels;
        return <div key={key} className={cn("relative border-l border-line", key === today && "bg-moon/5")} style={{ height }}>
          {Array.from({ length: steps }, (_, step) => {
            const minutes = firstHour * 60 + step * 30;
            const at = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
            const style = { top: step * hourPixels / 2, height: hourPixels / 2 };
            const className = cn("absolute inset-x-0 border-t border-line/70", step % 2 !== 0 && "border-dashed border-line/40");
            return onCreate ? <button type="button" key={step} disabled={loading} className={cn(className, "transition-colors hover:bg-moon/30 focus-visible:bg-moon/40 focus-visible:outline focus-visible:outline-crater")}
              style={style} aria-label={`${dateLabel.format(day)} ${at} ${t("create")}`} onClick={() => onCreate(dateTimeInputToInstant(`${key}T${at}`, timeZone)!)} />
              : <div key={step} className={className} style={style} />;
          })}
          {laidOutDays[index].map(({ item, fromMinute, toMinute, lane, lanes }) => {
            const eventHeight = Math.max(20, (toMinute - fromMinute) / 60 * hourPixels - 2);
            return <button type="button" key={item.id} onClick={() => onOpen(item)} title={titleFor(item)} aria-label={titleFor(item)}
              className={cn("absolute z-[2] overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-xs leading-tight shadow-sm transition hover:z-10 hover:brightness-95 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crater",
                CALENDAR_TONES[item.kind].block, item.muted && "opacity-50", item.pending && "border border-dashed", item.conflict && "ring-1 ring-rose")}
              style={{ top: (fromMinute / 60 - firstHour) * hourPixels + 1, height: eventHeight, left: `calc(${lane * 100 / lanes}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}>
              <p className="truncate font-medium">{item.title}</p>
              {eventHeight >= 34 ? <p className="truncate text-[10px]">{time.format(new Date(item.startsAt))}–{time.format(new Date(item.endsAt))}{item.state ? ` · ${item.state}` : ""}</p> : null}
              {eventHeight >= 52 && item.subtitle ? <p className="truncate text-[11px] text-muted">{item.subtitle}</p> : null}
              {eventHeight >= 68 && item.detail ? <p className="truncate text-[10px] text-muted">{item.detail}</p> : null}
            </button>;
          })}
          {key === today && marker >= 0 && marker < height ? <div className="pointer-events-none absolute inset-x-0 z-[4] border-t border-rose" style={{ top: marker }}>
            <span className="absolute -left-1 -top-1 size-2 rounded-full bg-rose" />
          </div> : null}
        </div>;
      })}
    </div>
  </div>;
}
