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
  startDate: Date,
  weekdays: readonly number[],
  timeHH: number,
  timeMM: number,
  durationMin: number,
): ScheduledSession[] {
  if (lectures.length === 0 || weekdays.length === 0) return [];
  const weekdaySet = new Set(weekdays);
  const results: Date[] = [];
  const cursor = new Date(startDate);
  cursor.setHours(timeHH, timeMM, 0, 0);
  // 保底循环次数，避免 weekdays 传参异常时死循环
  let guard = lectures.length * 14 + 60;
  while (results.length < lectures.length && guard-- > 0) {
    if (weekdaySet.has(cursor.getDay())) {
      results.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return lectures.map((lecture, index) => ({
    ...lecture,
    scheduledAt: results[index] ?? new Date(startDate),
    durationMin,
  }));
}
