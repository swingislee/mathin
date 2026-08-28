import { zonedDateTimeToInstant } from "./schedule";
import { isAutomaticTeachingDay, type TeachingCalendarEntryV2 } from "./teaching-calendar";

export interface LectureSlot {
  lectureId: string;
  no: number;
  name: string;
}

export interface ScheduledSession extends LectureSlot {
  scheduledAt: Date;
  durationMin: number;
}

/**
 * 按「开始日期 + 每周几 + 时间段」把讲次顺序铺到日历上：
 * 从开始日期起逐日推进，命中 weekdays 的那天依次分配给下一讲，直至讲次用完。
 * 多个 weekday（如周一/周三）天然按日期先后交替分配，不需要额外洗牌。
 */
export function generateSchedulePreview(
  lectures: LectureSlot[],
  startDate: string,
  weekdays: readonly number[],
  timeHH: number,
  timeMM: number,
  durationMin: number,
  timeZone: string,
  calendar?: {
    entries: readonly TeachingCalendarEntryV2[];
    campusId: string | null;
  },
): ScheduledSession[] {
  if (lectures.length === 0 || weekdays.length === 0) return [];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!match) return [];
  const weekdaySet = new Set(weekdays);
  const results: Date[] = [];
  const cursor = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  // 保底循环次数，避免 weekdays 传参异常时死循环
  let guard = lectures.length * 14 + 60;
  while (results.length < lectures.length && guard-- > 0) {
    const day = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    if (isAutomaticTeachingDay(
      calendar?.entries ?? [],
      day,
      cursor.getUTCDay(),
      weekdaySet,
      calendar?.campusId ?? null,
    )) {
      results.push(zonedDateTimeToInstant({
        year: cursor.getUTCFullYear(),
        month: cursor.getUTCMonth(),
        day: cursor.getUTCDate(),
        hour: timeHH,
        minute: timeMM,
      }, timeZone));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return results.map((scheduledAt, index) => ({
    ...lectures[index],
    scheduledAt,
    durationMin,
  }));
}
