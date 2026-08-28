export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** 统一从机构 IANA 时区提取日历字段；禁止依赖浏览器或 Node 进程本地时区。 */
export function zonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month) - 1,
    day: Number(values.day),
    weekday: WEEKDAY_INDEX[values.weekday],
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

/** 将机构本地日历时间折成 UTC instant；迭代修正可覆盖 DST 偏移变化。 */
export function zonedDateTimeToInstant(
  parts: Pick<ZonedDateParts, "year" | "month" | "day"> & Partial<Pick<ZonedDateParts, "hour" | "minute">>,
  timeZone: string,
): Date {
  const target = Date.UTC(parts.year, parts.month, parts.day, parts.hour ?? 0, parts.minute ?? 0);
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedDateParts(new Date(instant), timeZone);
    const represented = Date.UTC(actual.year, actual.month, actual.day, actual.hour, actual.minute);
    const delta = target - represented;
    instant += delta;
    if (delta === 0) break;
  }
  return new Date(instant);
}

export function calendarDayKey(date: Date, timeZone: string): string {
  const parts = zonedDateParts(date, timeZone);
  return `${parts.year}-${String(parts.month + 1).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function zonedDateTimeInputValue(date: Date, timeZone: string): string {
  const parts = zonedDateParts(date, timeZone);
  return `${parts.year}-${String(parts.month + 1).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function dateTimeInputToInstant(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const result = zonedDateTimeToInstant({
    year: Number(match[1]),
    month: Number(match[2]) - 1,
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  }, timeZone);
  if (Number.isNaN(result.getTime())) return null;
  // Spring-forward gaps are not real local times. Reject them instead of
  // silently moving a lesson to a different wall-clock time.
  const roundTrip = zonedDateParts(result, timeZone);
  return roundTrip.year === Number(match[1])
    && roundTrip.month === Number(match[2]) - 1
    && roundTrip.day === Number(match[3])
    && roundTrip.hour === Number(match[4])
    && roundTrip.minute === Number(match[5])
    ? result
    : null;
}

export function startOfDay(date: Date, timeZone: string): Date {
  const { year, month, day } = zonedDateParts(date, timeZone);
  return zonedDateTimeToInstant({ year, month, day }, timeZone);
}

export function addCalendarDays(date: Date, days: number, timeZone: string): Date {
  const parts = zonedDateParts(date, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month, parts.day + days));
  return zonedDateTimeToInstant({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
  }, timeZone);
}

export function startOfWeek(date: Date, timeZone: string): Date {
  const { weekday } = zonedDateParts(date, timeZone);
  const diff = weekday === 0 ? -6 : 1 - weekday;
  return addCalendarDays(startOfDay(date, timeZone), diff, timeZone);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function startOfMonth(date: Date, timeZone: string): Date {
  const { year, month } = zonedDateParts(date, timeZone);
  return zonedDateTimeToInstant({ year, month, day: 1 }, timeZone);
}

export interface ScheduleEntry {
  sessionId: string;
  studentId: string;
  classroomId: string;
  classroomName: string;
  lectureName: string;
  scheduledAt: string;
  durationMin: number;
  teacherName: string;
  studentName: string;
  roomId: string | null;
  roomName: string | null;
  campusId: string | null;
  campusName: string | null;
  roomAssignmentOrigin: "class_default" | "session_override" | null;
}

export interface ScheduleBlock extends ScheduleEntry {
  conflict: boolean;
}

/** 按某个字段分组、组内按开始时间排序，标出区间重叠（start1 < end2 && start2 < end1）的 sessionId。 */
function collectOverlapConflicts(entries: ScheduleEntry[], keyOf: (entry: ScheduleEntry) => string): Set<string> {
  const byKey = new Map<string, ScheduleEntry[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (!key) continue;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(entry);
  }

  const conflictIds = new Set<string>();
  for (const group of byKey.values()) {
    const sorted = [...group].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const aStart = new Date(a.scheduledAt).getTime();
      const aEnd = aStart + a.durationMin * 60_000;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        const bStart = new Date(b.scheduledAt).getTime();
        if (bStart >= aEnd) break;
        const bEnd = bStart + b.durationMin * 60_000;
        if (aStart < bEnd && bStart < aEnd) {
          conflictIds.add(a.sessionId);
          conflictIds.add(b.sessionId);
        }
      }
    }
  }
  return conflictIds;
}

/**
 * 同教师或同教室同时段重叠标冲突色（10-§9 P4B-4 验收项；P4I-16 补上教室维度）：
 * teacherName/roomId 为空时对应维度不参与冲突判定。同名但不同 UUID 的教室不会冲突。
 */
export function markConflicts(entries: ScheduleEntry[]): ScheduleBlock[] {
  const teacherConflicts = collectOverlapConflicts(entries, (entry) => entry.teacherName);
  const roomConflicts = collectOverlapConflicts(entries, (entry) => entry.roomId ?? "");
  return entries.map((entry) => ({
    ...entry,
    conflict: teacherConflicts.has(entry.sessionId) || roomConflicts.has(entry.sessionId),
  }));
}
