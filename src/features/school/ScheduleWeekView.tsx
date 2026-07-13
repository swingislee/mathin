"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getWeekSchedule } from "./actions";
import { fromSelectValue, toSelectValue } from "./controls";
import { markConflicts, type ScheduleBlock } from "./schedule";

const HOUR_START = 8;
const HOUR_END = 21;
const SLOT_MIN = 30;
const SLOT_COUNT = ((HOUR_END - HOUR_START) * 60) / SLOT_MIN;
const WEEKDAY_OFFSETS = [0, 1, 2, 3, 4, 5, 6]; // 周一起算

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=周日
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function slotIndex(date: Date): number {
  const minutes = (date.getHours() - HOUR_START) * 60 + date.getMinutes();
  return Math.min(Math.max(Math.round(minutes / SLOT_MIN), 0), SLOT_COUNT - 1);
}

export function ScheduleWeekView({ canFilterTeacher }: { canFilterTeacher: boolean }) {
  const t = useTranslations("school.schedule");
  const locale = useLocale();
  const [anchor, setAnchor] = useState(() => new Date());
  const [entries, setEntries] = useState<ScheduleBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [teacherFilter, setTeacherFilter] = useState("");

  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  useEffect(() => {
    let cancelled = false;
    void getWeekSchedule(weekStart.toISOString(), weekEnd.toISOString())
      .then((rows) => {
        if (cancelled) return;
        setEntries(markConflicts(rows));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, weekEnd]);

  const jumpWeek = (days: number) => {
    setLoading(true);
    setAnchor((prev) => addDays(prev, days));
  };

  const jumpToday = () => {
    setLoading(true);
    setAnchor(new Date());
  };

  const teacherOptions = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.teacherName).filter(Boolean))).sort(),
    [entries],
  );

  const visibleEntries = teacherFilter ? entries.filter((entry) => entry.teacherName === teacherFilter) : entries;

  const days = WEEKDAY_OFFSETS.map((offset) => addDays(weekStart, offset));
  const dayFormatter = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", weekday: "short" });
  const timeFormatter = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => jumpWeek(-7)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          {t("prevWeek")}
        </button>
        <button type="button" onClick={jumpToday} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          {t("today")}
        </button>
        <button type="button" onClick={() => jumpWeek(7)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          {t("nextWeek")}
        </button>
        <span className="text-sm text-muted">{dayFormatter.format(weekStart)} – {dayFormatter.format(addDays(weekStart, 6))}</span>
        {canFilterTeacher && teacherOptions.length > 0 && (
          <Select value={toSelectValue(teacherFilter)} onValueChange={(value) => setTeacherFilter(fromSelectValue(value))}>
            <SelectTrigger className="ml-auto"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={toSelectValue("")}>{t("allTeachers")}</SelectItem>
              {teacherOptions.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-muted">{t("loading")}</p>
      ) : visibleEntries.length === 0 ? (
        <p className="mt-6 rounded-xl border border-line bg-card p-5 text-sm text-muted">{t("empty")}</p>
      ) : null}

      <div
        className="mt-4 overflow-x-auto rounded-xl border border-line"
        style={{ display: !loading ? "block" : "none" }}
      >
        <div
          className="grid min-w-[820px]"
          style={{ gridTemplateColumns: `64px repeat(7, 1fr)`, gridTemplateRows: `auto repeat(${SLOT_COUNT}, 28px)` }}
        >
          <div className="border-b border-line bg-card" />
          {days.map((day) => (
            <div key={day.toISOString()} className="border-b border-l border-line bg-card px-2 py-2 text-center text-xs text-muted">
              {dayFormatter.format(day)}
            </div>
          ))}

          {Array.from({ length: SLOT_COUNT }, (_, slot) => {
            const isHour = slot % (60 / SLOT_MIN) === 0;
            const hour = HOUR_START + Math.floor(slot / (60 / SLOT_MIN));
            return (
              <div
                key={`label-${slot}`}
                className="border-t border-line px-2 text-right text-[10px] text-muted"
                style={{ gridColumn: 1, gridRow: slot + 2 }}
              >
                {isHour ? `${hour}:00` : ""}
              </div>
            );
          })}

          {days.map((day, dayIndex) =>
            Array.from({ length: SLOT_COUNT }, (_, slot) => (
              <div
                key={`cell-${dayIndex}-${slot}`}
                className="border-t border-l border-line"
                style={{ gridColumn: dayIndex + 2, gridRow: slot + 2 }}
              />
            )),
          )}

          {visibleEntries.map((entry) => {
            const date = new Date(entry.scheduledAt);
            const dayIndex = days.findIndex((day) => day.toDateString() === date.toDateString());
            if (dayIndex === -1) return null;
            const startSlot = slotIndex(date);
            const span = Math.max(1, Math.round(entry.durationMin / SLOT_MIN));
            return (
              <div
                key={entry.sessionId}
                className={cn(
                  "m-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight",
                  entry.conflict ? "border-rose bg-rose/15 text-rose" : "border-crater/40 bg-crater/10 text-ink",
                )}
                style={{ gridColumn: dayIndex + 2, gridRow: `${startSlot + 2} / span ${span}` }}
                title={`${timeFormatter.format(date)} ${entry.classroomName} ${entry.lectureName}`}
              >
                <p className="truncate font-medium">{timeFormatter.format(date)} {entry.classroomName || t("freeClass")}</p>
                {entry.lectureName && <p className="truncate text-muted">{entry.lectureName}</p>}
                {entry.teacherName && <p className="truncate text-muted">{entry.teacherName}</p>}
                {entry.studentName && <p className="truncate text-muted">{entry.studentName}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
