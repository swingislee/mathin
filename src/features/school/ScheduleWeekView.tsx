"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { getWeekSchedule } from "./actions/schedule";
import { fromSelectValue, toSelectValue } from "./controls";
import { addDays, markConflicts, startOfWeek, type ScheduleBlock } from "./schedule";

const HOUR_START = 8;
const HOUR_END = 21;
const SLOT_MIN = 30;
const SLOT_PX = 28;
const SLOT_COUNT = ((HOUR_END - HOUR_START) * 60) / SLOT_MIN;
const WEEKDAY_OFFSETS = [0, 1, 2, 3, 4, 5, 6]; // 周一起算

function slotIndex(date: Date): number {
  const minutes = (date.getHours() - HOUR_START) * 60 + date.getMinutes();
  return Math.min(Math.max(Math.floor(minutes / SLOT_MIN), 0), SLOT_COUNT - 1);
}

interface LaidOutBlock {
  entry: ScheduleBlock;
  lane: number;
  lanes: number;
}

/**
 * 同一天里时间重叠的课次（例如两个不同班级撞在同一时段）原本会在网格里完全叠在同一格，
 * 后加入的会盖住先加入的，导致前者彻底点不到——按经典"会议室"区间图着色分道并排展示，
 * 互不重叠的课次仍各自占满整列。
 */
function layoutDayEntries(dayEntries: ScheduleBlock[]): LaidOutBlock[] {
  const sorted = [...dayEntries].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const clusters: ScheduleBlock[][] = [];
  let current: ScheduleBlock[] = [];
  let clusterEnd = -Infinity;
  for (const entry of sorted) {
    const start = new Date(entry.scheduledAt).getTime();
    const end = start + entry.durationMin * 60_000;
    if (current.length > 0 && start >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(entry);
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (current.length > 0) clusters.push(current);

  const result: LaidOutBlock[] = [];
  for (const cluster of clusters) {
    const laneEnds: number[] = [];
    const withLane = cluster.map((entry) => {
      const start = new Date(entry.scheduledAt).getTime();
      const end = start + entry.durationMin * 60_000;
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[lane] = end;
      }
      return { entry, lane };
    });
    const lanes = laneEnds.length;
    for (const item of withLane) result.push({ entry: item.entry, lane: item.lane, lanes });
  }
  return result;
}

/** 当前时间在本周网格里的位置（今天不在可见周内则返回 null）。 */
function useNowMarker(days: Date[]) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const dayIndex = days.findIndex((day) => day.toDateString() === now.toDateString());
  if (dayIndex === -1) return null;
  const minutes = (now.getHours() - HOUR_START) * 60 + now.getMinutes();
  if (minutes < 0 || minutes >= (HOUR_END - HOUR_START) * 60) return null;
  const slot = Math.floor(minutes / SLOT_MIN);
  const offsetPx = ((minutes % SLOT_MIN) / SLOT_MIN) * SLOT_PX;
  return { dayIndex, slot, offsetPx };
}

export function ScheduleWeekView({ canFilterAll }: { canFilterAll: boolean }) {
  const t = useTranslations("school.schedule");
  const locale = useLocale();
  const [anchor, setAnchor] = useState(() => new Date());
  const [entries, setEntries] = useState<ScheduleBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [teacherFilter, setTeacherFilter] = useState("");
  const [classroomFilter, setClassroomFilter] = useState("");
  const [roomFilter, setRoomFilter] = useState("");

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
  const classroomOptions = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.classroomName).filter(Boolean))).sort(),
    [entries],
  );
  const roomOptions = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.room).filter(Boolean))).sort(),
    [entries],
  );

  const visibleEntries = entries
    .filter((entry) => !teacherFilter || entry.teacherName === teacherFilter)
    .filter((entry) => !classroomFilter || entry.classroomName === classroomFilter)
    .filter((entry) => !roomFilter || entry.room === roomFilter);

  const days = WEEKDAY_OFFSETS.map((offset) => addDays(weekStart, offset));
  const dayFormatter = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", weekday: "short" });
  const timeFormatter = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const nowMarker = useNowMarker(days);

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
        {canFilterAll && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {teacherOptions.length > 0 && (
              <Select value={toSelectValue(teacherFilter)} onValueChange={(value) => setTeacherFilter(fromSelectValue(value))}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={toSelectValue("")}>{t("allTeachers")}</SelectItem>
                  {teacherOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {classroomOptions.length > 0 && (
              <Select value={toSelectValue(classroomFilter)} onValueChange={(value) => setClassroomFilter(fromSelectValue(value))}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={toSelectValue("")}>{t("allClassrooms")}</SelectItem>
                  {classroomOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {roomOptions.length > 0 && (
              <Select value={toSelectValue(roomFilter)} onValueChange={(value) => setRoomFilter(fromSelectValue(value))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={toSelectValue("")}>{t("allRooms")}</SelectItem>
                  {roomOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
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
          className="relative grid min-w-[820px]"
          style={{ gridTemplateColumns: `64px repeat(7, 1fr)`, gridTemplateRows: `auto repeat(${SLOT_COUNT}, ${SLOT_PX}px)` }}
        >
          <div className="sticky top-0 z-10 border-b border-line bg-card" style={{ gridColumn: 1, gridRow: 1 }} />
          {days.map((day, dayIndex) => (
            <div
              key={day.toISOString()}
              className="sticky top-0 z-10 border-b border-l border-line bg-card px-2 py-2 text-center text-xs text-muted"
              style={{ gridColumn: dayIndex + 2, gridRow: 1 }}
            >
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

          {nowMarker && (
            <div
              className="pointer-events-none relative z-[5] border-t-2 border-rose"
              style={{ gridColumn: nowMarker.dayIndex + 2, gridRow: nowMarker.slot + 2, marginTop: `${nowMarker.offsetPx}px` }}
            >
              <span className="absolute -left-1 -top-1 size-2 rounded-full bg-rose" />
            </div>
          )}

          {days.map((day, dayIndex) => {
            const dayEntries = visibleEntries.filter((entry) => new Date(entry.scheduledAt).toDateString() === day.toDateString());
            if (dayEntries.length === 0) return null;
            return (
              // 相对定位的整列包裹层：本身是普通网格项（尺寸=这一天这一列的真实像素宽高），
              // 内部课次块用绝对定位百分比分道并排——若不套这层包裹直接把课次块设为网格项
              // 的绝对定位子项，left/width 百分比会按整个日历网格（7 天）而不是这一天这一列
              // 折算，摆位会跨列错位（P4I-16 实现时用 Playwright 截图+computed style 排查确认）。
              <div key={day.toISOString()} className="relative" style={{ gridColumn: dayIndex + 2, gridRow: `2 / span ${SLOT_COUNT}` }}>
                {layoutDayEntries(dayEntries).map(({ entry, lane, lanes }) => {
                  const date = new Date(entry.scheduledAt);
                  const startSlot = slotIndex(date);
                  const span = Math.max(1, Math.round(entry.durationMin / SLOT_MIN));
                  const widthPct = 100 / lanes;
                  return (
                    <Link
                      key={entry.sessionId}
                      href={`/dashboard/schedule?session=${entry.sessionId}`}
                      className={cn(
                        "absolute overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight transition hover:z-[6] hover:brightness-95 focus-visible:z-[6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crater",
                        entry.conflict ? "border-rose bg-rose/15 text-rose" : "border-crater/40 bg-crater/10 text-ink",
                      )}
                      style={{
                        top: `${startSlot * SLOT_PX + 1}px`,
                        height: `${span * SLOT_PX - 2}px`,
                        left: `calc(${lane * widthPct}% + 1px)`,
                        width: `calc(${widthPct}% - 2px)`,
                      }}
                      title={`${timeFormatter.format(date)} ${entry.classroomName} ${entry.lectureName}`}
                    >
                      <p className="truncate font-medium">{timeFormatter.format(date)} {entry.classroomName || t("freeClass")}</p>
                      {entry.lectureName && <p className="truncate text-muted">{entry.lectureName}</p>}
                      {entry.teacherName && <p className="truncate text-muted">{entry.teacherName}</p>}
                      {entry.studentName && <p className="truncate text-muted">{entry.studentName}</p>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
