"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { STAFF_OVERVIEW_DATE_COOKIE, STAFF_OVERVIEW_GRAIN_COOKIE, staffHomeHref } from "./staff-home-contract";
import type { StaffOverviewGrain } from "./staff-overview-contract";

// 日历只展示年月日；业务统计在服务端按机构时区解析同一日期。
function calendarDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function StaffOverviewPeriodPicker({
  grain, selection, selectedDate, today, range, previousDate, nextDate, isPrevious,
}: {
  grain: StaffOverviewGrain;
  selection: string;
  selectedDate: string;
  today: string;
  range: string;
  previousDate: string;
  nextDate: string | null;
  isPrevious: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("school.home.overview");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [year, setYear] = useState(selectedDate.slice(0, 4));
  const [visibleMonth, setVisibleMonth] = useState(() => calendarDate(selectedDate));
  const selected = calendarDate(selectedDate);
  const weekEnd = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() + 6);
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));

  useEffect(() => {
    document.cookie = `${STAFF_OVERVIEW_GRAIN_COOKIE}=${grain}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.cookie = `${STAFF_OVERVIEW_DATE_COOKIE}=${encodeURIComponent(selection)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [grain, selection]);

  const choose = (date: string) => {
    setOpen(false);
    startTransition(() => router.push(staffHomeHref("overview", grain, date), { scroll: false }));
  };

  return (
    <div className="flex flex-wrap items-center gap-1" aria-busy={pending}>
      <Link href={staffHomeHref("overview", grain, "previous")} scroll={false} aria-current={isPrevious ? "date" : undefined}
        className={cn(buttonVariants({ size: "sm", variant: isPrevious ? "secondary" : "ghost" }), "h-8 px-2 text-xs")}>{t(`review_${grain}`)}</Link>
      <Link href={staffHomeHref("overview", grain, "current")} scroll={false} aria-current={!nextDate ? "date" : undefined}
        className={cn(buttonVariants({ size: "sm", variant: !nextDate ? "secondary" : "ghost" }), "h-8 px-2 text-xs")}>{t(`progress_${grain}`)}</Link>
      <Link href={staffHomeHref("overview", grain, previousDate)} scroll={false} aria-label={t(`previous_${grain}`)} title={t(`previous_${grain}`)}
        className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "size-8 p-0")}><ChevronLeft className="size-4" /></Link>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="secondary" className="h-8 gap-1.5 px-2 text-xs tabular-nums" disabled={pending} aria-label={`${t(`choose_${grain}`)}：${range}`}>
            <CalendarDays className="size-3.5" aria-hidden />{range}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] space-y-3 p-3">
          <p className="text-xs text-muted">{t(`choose_${grain}`)}</p>
          {grain === "week" ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Select value={String(visibleMonth.getFullYear())} onValueChange={value => setVisibleMonth(new Date(Number(value), Math.min(visibleMonth.getMonth(), Number(value) === currentYear ? currentMonth - 1 : 11), 1))}>
                  <SelectTrigger className="h-8 flex-1" aria-label={t("chooseYear")}><SelectValue /></SelectTrigger>
                  <SelectContent>{Array.from({ length: currentYear - 1899 }, (_, index) => String(currentYear - index)).map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={String(visibleMonth.getMonth())} onValueChange={value => setVisibleMonth(new Date(visibleMonth.getFullYear(), Number(value), 1))}>
                  <SelectTrigger className="h-8 flex-1" aria-label={t("chooseMonth")}><SelectValue /></SelectTrigger>
                  <SelectContent>{Array.from({ length: visibleMonth.getFullYear() === currentYear ? currentMonth : 12 }, (_, month) => (
                    <SelectItem key={month} value={String(month)}>{new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2000, month, 1))}</SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>
              <Calendar mode="range" selected={{ from: selected, to: weekEnd }} month={visibleMonth} onMonthChange={setVisibleMonth}
                hideNavigation classNames={{ month_caption: "hidden", month: "space-y-1" }}
                weekStartsOn={1} startMonth={new Date(1900, 0, 1)} endMonth={calendarDate(today)}
                disabled={{ after: calendarDate(today) }} onDayClick={(day, modifiers) => {
                  if (!modifiers.disabled) choose(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`);
                }} />
            </div>
          ) : (
            <div className="w-64 space-y-3">
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="h-8" aria-label={t("chooseYear")}><SelectValue /></SelectTrigger>
                <SelectContent>{Array.from({ length: currentYear - 1899 }, (_, index) => String(currentYear - index)).map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
              </Select>
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: 12 }, (_, index) => {
                  const value = `${year}-${String(index + 1).padStart(2, "0")}-01`;
                  return <Button key={value} variant={value === selectedDate ? "secondary" : "ghost"} size="sm"
                    disabled={Number(year) === currentYear && index + 1 > currentMonth} onClick={() => choose(value)}>
                    {new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2000, index, 1)))}
                  </Button>;
                })}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {nextDate ? (
        <Link href={staffHomeHref("overview", grain, nextDate)} scroll={false} aria-label={t(`next_${grain}`)} title={t(`next_${grain}`)}
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "size-8 p-0")}><ChevronRight className="size-4" /></Link>
      ) : <Button size="sm" variant="ghost" className="size-8 p-0" disabled aria-label={t(`next_${grain}`)}><ChevronRight className="size-4" /></Button>}
    </div>
  );
}
