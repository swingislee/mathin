"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { RouteTabs } from "../navigation/RouteTabs";
import { availableTeachingTerms, teachingTimeHref, type TeachingTerm, type TeachingTimeGrain, type TeachingTimeWindow } from "./teaching-period-contract";

const calendarDate = (date: string) => { const [year, month, day] = date.split("-").map(Number); return new Date(year, month - 1, day); };

export function TeachingPeriodPicker({ grain, window, baseHref, terms, today }: {
  grain: TeachingTimeGrain; window: TeachingTimeWindow | null; baseHref: string; terms: TeachingTerm[]; today: string;
}) {
  const t = useTranslations("school.teachingWorkbench.time");
  const scheduleT = useTranslations("school.schedule");
  const locale = useLocale(); const router = useRouter();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState((window?.date ?? today).slice(0, 4));
  const [month, setMonth] = useState(() => calendarDate(window?.date ?? today));
  const href = (date: string, termId?: string) => teachingTimeHref(baseHref, grain, date, termId);
  const choose = (date: string, termId?: string) => { setOpen(false); router.push(href(date, termId), { scroll: false }); };
  const termRows = availableTeachingTerms(terms);
  const term = termRows.find(row => row.id === window?.termId);
  const range = window ? `${window.date} — ${window.lastDate}` : t("termUnavailable");
  return <div className="flex flex-wrap items-center gap-1" data-teaching-period-picker>
    <RouteTabs ariaLabel={t("dimension")} activeValue={grain} items={(["week", "month", "term"] as const).map(value => ({ value, label: t(value), href: teachingTimeHref(baseHref, value, window?.date ?? "current") }))} />
    {(["current", "previous"] as const).map(value => <Link key={value} prefetch={false} scroll={false} href={href(value)} aria-current={window && (value === "current" ? window.current : window.previousSelected) ? "date" : undefined}
      className={buttonVariants({ size: "sm", variant: window && (value === "current" ? window.current : window.previousSelected) ? "secondary" : "ghost", className: "h-8 px-2 text-xs" })}>{t(`${value}_${grain}`)}</Link>)}
    {window?.previous ? <Link prefetch={false} scroll={false} href={href(window.previous)} aria-label={t(`earlier_${grain}`)} className={buttonVariants({ variant: "ghost", size: "sm", className: "size-8 p-0" })}><ChevronLeft className="size-4" /></Link>
      : <Button disabled size="sm" variant="ghost" className="size-8 p-0" aria-label={t(`earlier_${grain}`)}><ChevronLeft className="size-4" /></Button>}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="secondary" size="sm" className="h-8 gap-1.5 px-2 text-xs tabular-nums" aria-label={`${t("choose")}：${range}`}><CalendarDays className="size-3.5" aria-hidden />{term ? `${term.year}–${term.year + 1} · ${scheduleT(`period${term.term}`)} · ` : ""}{range}</Button></PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] space-y-3 p-3">
        {grain === "week" ? <Calendar mode="range" month={month} onMonthChange={setMonth} weekStartsOn={1}
          selected={window ? { from: calendarDate(window.date), to: calendarDate(window.lastDate) } : undefined}
          onDayClick={day => choose(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`)} />
          : grain === "month" ? <div className="w-64 space-y-3"><Select value={year} onValueChange={setYear}><SelectTrigger aria-label={t("year")}><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 31 }, (_, index) => String(Number(today.slice(0, 4)) + 1 - index)).map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
            <div className="grid grid-cols-3 gap-1">{Array.from({ length: 12 }, (_, index) => { const value = `${year}-${String(index + 1).padStart(2, "0")}-01`; return <Button key={value} size="sm" variant={value === window?.date ? "secondary" : "ghost"} onClick={() => choose(value)}>{new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(2000, index, 1))}</Button>; })}</div></div>
          : <div className="flex max-h-64 min-w-64 flex-col gap-1 overflow-auto">{termRows.length ? termRows.map(row => <Button key={row.id} variant={row.id === window?.termId ? "secondary" : "ghost"} size="sm" className="justify-start" onClick={() => choose(row.startsOn!, row.id)}>{row.year}–{row.year + 1} · {scheduleT(`period${row.term}`)}</Button>) : <p className="text-sm text-muted">{t("termUnavailable")}</p>}</div>}
      </PopoverContent>
    </Popover>
    {window?.next ? <Link prefetch={false} scroll={false} href={href(window.next)} aria-label={t(`later_${grain}`)} className={buttonVariants({ variant: "ghost", size: "sm", className: "size-8 p-0" })}><ChevronRight className="size-4" /></Link>
      : <Button disabled size="sm" variant="ghost" className="size-8 p-0" aria-label={t(`later_${grain}`)}><ChevronRight className="size-4" /></Button>}
  </div>;
}
