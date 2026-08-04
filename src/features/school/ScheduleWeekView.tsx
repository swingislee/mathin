"use client";

import { DashboardEmptyCard } from "@/features/school/dashboard-page";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardPage,
} from "./dashboard-page";
import { FilterSelectTrigger } from "./FilterBar";
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

/**
 * 课表整页（docs/plan/21 §9）。它自己渲染 DashboardPage 而不是由 page.tsx 渲染：
 * 周次切换和三个筛选都是本组件的客户端状态，只有住在这里才能进命令面板。
 * DashboardPage 是同步组件，Client Component 可以直接渲染（同 TileWorkspace）。
 *
 * 内部滚动保留：课表在路由合同里是 shellMode: "panel"，日期表头 sticky 贴的是下面这个
 * ScrollArea 的视口。若改成随 main 一起滚，表头会贴到 chrome 背后被盖住。
 */
export function ScheduleWeekView({
  title,
  canFilterAll,
  termManager,
}: {
  title: string;
  canFilterAll: boolean;
  termManager?: ReactNode;
}) {
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

  const hasFilters = canFilterAll && (teacherOptions.length > 0 || classroomOptions.length > 0 || roomOptions.length > 0);

  return (
    <DashboardPage
      title={title}
      // 周区间是"我在看哪一周"，属于页面身份而不是操作——放 meta，命令面板第一行
      // 就只剩三个按钮，390px 下不会被日期串挤到换行。
      meta={<span>{dayFormatter.format(weekStart)} – {dayFormatter.format(addDays(weekStart, 6))}</span>}
      density="compact"
      className="flex w-full min-w-0 flex-1 flex-col panel-canvas"
      bodyClassName="min-h-0 flex-1"
      contentClassName="flex min-h-0 flex-1 flex-col"
      commandPanel={
        <DashboardCommandPanel>
          <DashboardCommandState>
            {/* 上/下一周用图标按钮：命令面板第一行还要放学年学期设置，三个中文文字按钮在窄容器下放不下。 */}
            <Button type="button" variant="secondary" size="sm" className="size-9 px-0" aria-label={t("prevWeek")} title={t("prevWeek")} onClick={() => jumpWeek(-7)}>
              <ChevronLeft size={16} />
            </Button>
            <Button type="button" variant="secondary" size="sm" className="h-9" onClick={jumpToday}>
              {t("today")}
            </Button>
            <Button type="button" variant="secondary" size="sm" className="size-9 px-0" aria-label={t("nextWeek")} title={t("nextWeek")} onClick={() => jumpWeek(7)}>
              <ChevronRight size={16} />
            </Button>
          </DashboardCommandState>

          {hasFilters ? (
            <DashboardCommandFilters className="flex-wrap">
              {teacherOptions.length > 0 && (
                <Select value={toSelectValue(teacherFilter)} onValueChange={(value) => setTeacherFilter(fromSelectValue(value))}>
                  <FilterSelectTrigger className="w-36"><SelectValue /></FilterSelectTrigger>
                  <SelectContent>
                    <SelectItem value={toSelectValue("")}>{t("allTeachers")}</SelectItem>
                    {teacherOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {classroomOptions.length > 0 && (
                <Select value={toSelectValue(classroomFilter)} onValueChange={(value) => setClassroomFilter(fromSelectValue(value))}>
                  <FilterSelectTrigger className="w-36"><SelectValue /></FilterSelectTrigger>
                  <SelectContent>
                    <SelectItem value={toSelectValue("")}>{t("allClassrooms")}</SelectItem>
                    {classroomOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {roomOptions.length > 0 && (
                <Select value={toSelectValue(roomFilter)} onValueChange={(value) => setRoomFilter(fromSelectValue(value))}>
                  <FilterSelectTrigger className="w-32"><SelectValue /></FilterSelectTrigger>
                  <SelectContent>
                    <SelectItem value={toSelectValue("")}>{t("allRooms")}</SelectItem>
                    {roomOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </DashboardCommandFilters>
          ) : null}

          {termManager ? <DashboardCommandActions>{termManager}</DashboardCommandActions> : null}
        </DashboardCommandPanel>
      }
    >
      {loading ? (
        <p className="text-sm text-muted">{t("loading")}</p>
      ) : visibleEntries.length === 0 ? (
        <DashboardEmptyCard>{t("empty")}</DashboardEmptyCard>
      ) : null}

      {/* 加载中用 hidden 而不是卸载：整张网格重建会让滚动位置和当前时间线跳一下。 */}
      <ScrollArea
        orientation="both"
        className={cn("min-h-0 flex-1 rounded-xl border border-line", loading && "hidden")}
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
      </ScrollArea>
    </DashboardPage>
  );
}
