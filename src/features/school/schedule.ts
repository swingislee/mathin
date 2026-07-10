// 固定按东八区（无夏令时）折算日/周/月边界，不依赖 Node 进程 TZ——
// 部署容器默认 UTC，若靠 Date 的本地 getter 算边界，本地跑正常、上线后
// 今日课表/本周/本月业绩会整体偏移 8 小时（10-§7 代码审查发现）。
const CHINA_OFFSET_MS = 8 * 60 * 60_000;

function shanghaiParts(date: Date): { year: number; month: number; day: number; weekday: number } {
  const shifted = new Date(date.getTime() + CHINA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(), // 0=周日
  };
}

export function startOfDay(date: Date): Date {
  const { year, month, day } = shanghaiParts(date);
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - CHINA_OFFSET_MS);
}

export function startOfWeek(date: Date): Date {
  const { weekday } = shanghaiParts(date);
  const diff = weekday === 0 ? -6 : 1 - weekday;
  return addDays(startOfDay(date), diff);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function startOfMonth(date: Date): Date {
  const { year, month } = shanghaiParts(date);
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - CHINA_OFFSET_MS);
}

export interface ScheduleEntry {
  sessionId: string;
  classroomName: string;
  lectureName: string;
  scheduledAt: string;
  durationMin: number;
  teacherName: string;
  studentName: string;
}

export interface ScheduleBlock extends ScheduleEntry {
  conflict: boolean;
}

/**
 * 同教师同时段重叠标冲突色（10-§9 P4B-4 验收项）：
 * 按 teacherName 分组，组内按开始时间排序，区间重叠（start1 < end2 && start2 < end1）即互标冲突。
 * teacherName 为空（自由教室无教师成员）时不参与冲突判定。
 */
export function markConflicts(entries: ScheduleEntry[]): ScheduleBlock[] {
  const byTeacher = new Map<string, ScheduleEntry[]>();
  for (const entry of entries) {
    if (!entry.teacherName) continue;
    (byTeacher.get(entry.teacherName) ?? byTeacher.set(entry.teacherName, []).get(entry.teacherName)!).push(entry);
  }

  const conflictIds = new Set<string>();
  for (const group of byTeacher.values()) {
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

  return entries.map((entry) => ({ ...entry, conflict: conflictIds.has(entry.sessionId) }));
}
