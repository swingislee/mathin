import {
  addCalendarDays,
  calendarDayKey,
  startOfMonth,
  startOfWeek,
  zonedDateParts,
  zonedDateTimeToInstant,
} from "@/features/school/schedule";

export const STAFF_OVERVIEW_GRAINS = ["week", "month"] as const;
export type StaffOverviewGrain = (typeof STAFF_OVERVIEW_GRAINS)[number];

export const STAFF_OVERVIEW_METRICS = [
  "leads",
  "contacts",
  "invitations",
  "arrivals",
  "assessments",
  "enrollments",
] as const;
export type StaffOverviewMetric = (typeof STAFF_OVERVIEW_METRICS)[number];

export function normalizeOverviewGrain(value: string | undefined): StaffOverviewGrain {
  return value === "month" ? "month" : "week";
}

export interface StaffOverviewWindow {
  timeZone?: string;
  grain: StaffOverviewGrain;
  isComplete: boolean;
  currentStart: Date;
  currentEnd: Date;
  currentCutoff: Date;
  previousStart: Date;
  previousEnd: Date;
  previousCutoff: Date;
  currentDays: Date[];
  previousDays: Date[];
}

function monthStartOffset(date: Date, offset: number, timeZone: string): Date {
  const parts = zonedDateParts(date, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month + offset, 1));
  return zonedDateTimeToInstant({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: 1,
  }, timeZone);
}

function listCalendarDays(start: Date, end: Date, timeZone: string): Date[] {
  const days: Date[] = [];
  let cursor = start;
  while (cursor < end && days.length < 32) {
    days.push(cursor);
    cursor = addCalendarDays(cursor, 1, timeZone);
  }
  return days;
}

function previousMonthComparableCutoff(
  now: Date,
  previousStart: Date,
  previousEnd: Date,
  timeZone: string,
): Date {
  const current = zonedDateParts(now, timeZone);
  const previous = zonedDateParts(previousStart, timeZone);
  const previousMonthDays = new Date(Date.UTC(previous.year, previous.month + 1, 0)).getUTCDate();
  if (current.day > previousMonthDays) return previousEnd;
  return zonedDateTimeToInstant({
    year: previous.year,
    month: previous.month,
    day: current.day,
    hour: current.hour,
    minute: current.minute,
  }, timeZone);
}

/** URL 日期按机构时区定位自然周期；未来日期收敛到当前周期。 */
export function overviewPeriodAnchor(value: string | undefined, now: Date, timeZone: string): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return now;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900) return now;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return now;
  const date = zonedDateTimeToInstant({ year, month: month - 1, day }, timeZone);
  return date > now ? now : date;
}

/** 历史周期比较完整两期；当前周期比较截至此刻的相同日历进度。 */
export function buildStaffOverviewWindow(
  grain: StaffOverviewGrain,
  now: Date,
  timeZone: string,
  date?: string,
): StaffOverviewWindow {
  const anchor = overviewPeriodAnchor(date, now, timeZone);
  let currentStart = grain === "week" ? startOfWeek(anchor, timeZone) : startOfMonth(anchor, timeZone);
  if (date === "previous") {
    currentStart = grain === "week" ? addCalendarDays(currentStart, -7, timeZone) : monthStartOffset(currentStart, -1, timeZone);
  }
  const currentEnd = grain === "week"
    ? addCalendarDays(currentStart, 7, timeZone)
    : monthStartOffset(currentStart, 1, timeZone);
  const previousStart = grain === "week"
    ? addCalendarDays(currentStart, -7, timeZone)
    : monthStartOffset(currentStart, -1, timeZone);
  const previousEnd = currentStart;
  const currentCutoff = now < currentEnd ? now : currentEnd;
  const isComplete = currentEnd <= now;
  const previousCutoff = isComplete ? previousEnd : grain === "week"
    ? addCalendarDays(currentCutoff, -7, timeZone)
    : previousMonthComparableCutoff(currentCutoff, previousStart, previousEnd, timeZone);

  return {
    timeZone,
    grain,
    isComplete,
    currentStart,
    currentEnd,
    currentCutoff,
    previousStart,
    previousEnd,
    previousCutoff,
    currentDays: listCalendarDays(currentStart, currentEnd, timeZone),
    previousDays: listCalendarDays(previousStart, previousEnd, timeZone),
  };
}

export interface StaffOverviewFactEvent {
  at: string;
  sourceMonth?: string | null;
  sourceId?: string | null;
  sourceName?: string;
  sourceConfirmed?: boolean;
  /** 同一业务对象在同一周期只计一次时使用，例如反复进入“已确认”的邀约。 */
  id?: string;
}

/** 来源确认月份可以独立计入月报；日、周及每日曲线仍使用真实发生日期。 */
export function overviewFactInPeriod(event: StaffOverviewFactEvent, window: StaffOverviewWindow, period: "current" | "previous"): boolean {
  const start = period === "current" ? window.currentStart : window.previousStart;
  if (window.grain === "month" && event.sourceMonth !== undefined) {
    return event.sourceMonth === calendarDayKey(start, window.timeZone ?? "Asia/Shanghai").slice(0, 7);
  }
  const cutoff = period === "current" ? window.currentCutoff : window.previousCutoff;
  const instant = new Date(event.at);
  return instant >= start && instant < cutoff;
}

export interface StaffOverviewTrendPoint {
  currentDate: string | null;
  previousDate: string | null;
  current: number | null;
  previous: number | null;
}

export interface StaffOverviewComparison {
  current: number;
  previous: number;
  trend: StaffOverviewTrendPoint[];
}

export interface StaffOverviewAttributedFactEvent extends StaffOverviewFactEvent {
  personId: string | null;
}

export interface StaffOverviewPersonComparison {
  personId: string | null;
  current: number;
  previous: number;
}

export interface StaffOverviewPeriodMetric {
  current: number;
  previous: number;
}

export interface StaffOverviewTeacherParticipationEvent {
  id: string;
  studentId: string;
  at: string;
  /** 同一名学生可以由多位老师共同参与；个人分别计数，机构合计按学生去重。 */
  teacherIds: readonly string[];
}

export interface StaffOverviewEnrollmentOutcomeEvent extends StaffOverviewFactEvent {
  id: string;
  studentId: string;
  at: string;
  /** 来源已确认报名使用该行学科老师归属，报名月份独立于到访月份。 */
  sourceTeacherIds?: readonly string[];
}

export interface StaffOverviewTeacherOutcomeComparison {
  teacherId: string;
  participants: StaffOverviewPeriodMetric;
  enrollments: StaffOverviewPeriodMetric;
}

export interface StaffOverviewTeacherOutcomeSummary {
  totalParticipants: StaffOverviewPeriodMetric;
  totalEnrollments: StaffOverviewPeriodMetric;
  unattributedParticipants: StaffOverviewPeriodMetric;
  teachers: StaffOverviewTeacherOutcomeComparison[];
}

/**
 * 数字按同期截止比较；月趋势展示本月至今和完整上月，周趋势保持同期截止。
 * 未来日期为 null，已经过但无记录的日期为 0。
 */
export function aggregateStaffOverviewEvents(
  events: readonly StaffOverviewFactEvent[],
  window: StaffOverviewWindow,
  timeZone: string,
  uniquePerPeriod = false,
): StaffOverviewComparison {
  const currentIndex = new Map(window.currentDays.map((day, index) => [calendarDayKey(day, timeZone), index]));
  const previousIndex = new Map(window.previousDays.map((day, index) => [calendarDayKey(day, timeZone), index]));
  const pointCount = Math.max(window.currentDays.length, window.previousDays.length);
  const currentValues = Array<number | null>(pointCount).fill(null);
  const previousValues = Array<number | null>(pointCount).fill(null);
  const previousTrendCutoff = window.grain === "month" ? window.previousEnd : window.previousCutoff;

  window.currentDays.forEach((day, index) => {
    if (day < window.currentCutoff) currentValues[index] = 0;
  });
  window.previousDays.forEach((day, index) => {
    if (day < previousTrendCutoff) previousValues[index] = 0;
  });

  const seen = new Set<string>();
  const trendSeen = new Set<string>();
  let current = 0;
  let previous = 0;
  // 去重事实的趋势归入周期内最早发生日，独立于来源返回顺序。
  const orderedEvents = uniquePerPeriod ? [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) : events;
  for (const event of orderedEvents) {
    const instant = new Date(event.at);
    const inCurrent = overviewFactInPeriod(event, window, "current");
    const inPrevious = overviewFactInPeriod(event, window, "previous");
    const inPreviousTrend = instant >= window.previousStart && instant < previousTrendCutoff;
    if (!inCurrent && !inPrevious && !inPreviousTrend) continue;
    const period = inCurrent ? "current" : "previous";
    const uniqueKey = uniquePerPeriod && event.id ? `${period}:${event.id}` : null;
    if ((inCurrent || inPrevious) && (!uniqueKey || !seen.has(uniqueKey))) {
      if (inCurrent) current += 1;
      else previous += 1;
      if (uniqueKey) seen.add(uniqueKey);
    }
    if (uniqueKey && trendSeen.has(uniqueKey)) continue;
    if (Number.isNaN(instant.getTime()) || window.grain === "month" && event.sourceMonth !== undefined
      && calendarDayKey(instant, timeZone).slice(0, 7) !== event.sourceMonth) continue;
    const index = (inCurrent ? currentIndex : previousIndex).get(calendarDayKey(instant, timeZone));
    if (index === undefined) continue;
    if (uniqueKey) trendSeen.add(uniqueKey);
    if (inCurrent) {
      currentValues[index] = (currentValues[index] ?? 0) + 1;
    } else {
      previousValues[index] = (previousValues[index] ?? 0) + 1;
    }
  }

  return {
    current,
    previous,
    trend: Array.from({ length: pointCount }, (_, index) => ({
      currentDate: window.currentDays[index]?.toISOString() ?? null,
      previousDate: window.previousDays[index]?.toISOString() ?? null,
      current: currentValues[index],
      previous: previousValues[index],
    })),
  };
}

/**
 * 以事实记录上保存的责任人/操作人归组，并保持本期与上期使用同一口径。
 * personId=null 是明确的“未归属”，不能静默丢弃。
 */
export function aggregateStaffOverviewEventsByPerson(
  events: readonly StaffOverviewAttributedFactEvent[],
  window: StaffOverviewWindow,
  uniquePerPeriod = false,
): StaffOverviewPersonComparison[] {
  const result = new Map<string, StaffOverviewPersonComparison>();
  const seen = new Set<string>();
  const unassignedKey = "__unassigned__";

  for (const event of events) {
    const inCurrent = overviewFactInPeriod(event, window, "current");
    const inPrevious = overviewFactInPeriod(event, window, "previous");
    if (!inCurrent && !inPrevious) continue;

    const period = inCurrent ? "current" : "previous";
    const personKey = event.personId ?? unassignedKey;
    if (uniquePerPeriod && event.id) {
      const uniqueKey = `${period}:${personKey}:${event.id}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
    }

    const comparison = result.get(personKey) ?? {
      personId: event.personId,
      current: 0,
      previous: 0,
    };
    comparison[period] += 1;
    result.set(personKey, comparison);
  }

  return Array.from(result.values());
}

type OutcomePeriod = "current" | "previous";

interface ParticipationCohort {
  firstAt: Date;
  teacherFirstAt: Map<string, Date>;
}

/**
 * 老师参与按“学生 × 老师 × 周期”去重，机构总计按“学生 × 周期”去重。
 * 原生报名使用参与后的同期事实；来源已确认报名沿用报名月份与该行老师归属。
 */
export function summarizeTeacherParticipationOutcomes(
  participationEvents: readonly StaffOverviewTeacherParticipationEvent[],
  enrollmentEvents: readonly StaffOverviewEnrollmentOutcomeEvent[],
  window: StaffOverviewWindow,
): StaffOverviewTeacherOutcomeSummary {
  const cohorts: Record<OutcomePeriod, Map<string, ParticipationCohort>> = {
    current: new Map(),
    previous: new Map(),
  };

  for (const event of participationEvents) {
    const instant = new Date(event.at);
    if (Number.isNaN(instant.getTime())) continue;
    const period: OutcomePeriod | null = instant >= window.currentStart && instant < window.currentCutoff
      ? "current"
      : instant >= window.previousStart && instant < window.previousCutoff
        ? "previous"
        : null;
    if (!period) continue;

    const teacherIds = new Set(event.teacherIds.filter(Boolean));
    const existing = cohorts[period].get(event.studentId);
    const cohort = existing ?? { firstAt: instant, teacherFirstAt: new Map<string, Date>() };
    if (instant < cohort.firstAt) cohort.firstAt = instant;
    for (const teacherId of teacherIds) {
      const prior = cohort.teacherFirstAt.get(teacherId);
      if (!prior || instant < prior) cohort.teacherFirstAt.set(teacherId, instant);
    }
    cohorts[period].set(event.studentId, cohort);
  }

  const enrollmentsByStudent = new Map<string, Date[]>();
  for (const event of enrollmentEvents) {
    if (event.sourceConfirmed && event.sourceTeacherIds !== undefined) continue;
    const instant = new Date(event.at);
    if (Number.isNaN(instant.getTime())) continue;
    const values = enrollmentsByStudent.get(event.studentId) ?? [];
    values.push(instant);
    enrollmentsByStudent.set(event.studentId, values);
  }

  const summary: StaffOverviewTeacherOutcomeSummary = {
    totalParticipants: { current: 0, previous: 0 },
    totalEnrollments: { current: 0, previous: 0 },
    unattributedParticipants: { current: 0, previous: 0 },
    teachers: [],
  };
  const teachers = new Map<string, StaffOverviewTeacherOutcomeComparison>();
  const enrolledSubjects = { current: new Set<string>(), previous: new Set<string>() };
  const teacherEnrollments = new Map<string, Set<string>>();
  const recordEnrollment = (studentId: string, period: OutcomePeriod, teacherId?: string) => {
    enrolledSubjects[period].add(studentId);
    if (teacherId) {
      const key = `${period}:${teacherId}`;
      const subjects = teacherEnrollments.get(key) ?? new Set<string>();
      subjects.add(studentId);
      teacherEnrollments.set(key, subjects);
    }
  };

  for (const period of ["current", "previous"] as const) {
    const cutoff = period === "current" ? window.currentCutoff : window.previousCutoff;
    summary.totalParticipants[period] = cohorts[period].size;

    for (const [studentId, cohort] of cohorts[period]) {
      const enrollmentInstants = enrollmentsByStudent.get(studentId) ?? [];
      const enrolledAfterParticipation = enrollmentInstants.some((instant) => (
        instant >= cohort.firstAt && instant < cutoff
      ));
      if (enrolledAfterParticipation) recordEnrollment(studentId, period);
      if (cohort.teacherFirstAt.size === 0) summary.unattributedParticipants[period] += 1;

      for (const [teacherId, teacherFirstAt] of cohort.teacherFirstAt) {
        const teacher = teachers.get(teacherId) ?? {
          teacherId,
          participants: { current: 0, previous: 0 },
          enrollments: { current: 0, previous: 0 },
        };
        teacher.participants[period] += 1;
        if (enrollmentInstants.some((instant) => instant >= teacherFirstAt && instant < cutoff)) {
          recordEnrollment(studentId, period, teacherId);
        }
        teachers.set(teacherId, teacher);
      }
    }
  }

  for (const event of enrollmentEvents) {
    if (!event.sourceConfirmed || event.sourceTeacherIds === undefined) continue;
    for (const period of ["current", "previous"] as const) {
      if (!overviewFactInPeriod(event, window, period)) continue;
      recordEnrollment(event.studentId, period);
      for (const teacherId of new Set(event.sourceTeacherIds.filter(Boolean))) {
        if (!teachers.has(teacherId)) teachers.set(teacherId, {
          teacherId, participants: { current: 0, previous: 0 }, enrollments: { current: 0, previous: 0 },
        });
        recordEnrollment(event.studentId, period, teacherId);
      }
    }
  }
  for (const period of ["current", "previous"] as const) {
    summary.totalEnrollments[period] = enrolledSubjects[period].size;
    for (const teacher of teachers.values()) teacher.enrollments[period] = teacherEnrollments.get(`${period}:${teacher.teacherId}`)?.size ?? 0;
  }
  summary.teachers = Array.from(teachers.values());
  return summary;
}

export interface ClassroomCapacityPolicy {
  minimumOpen: number;
  healthy: number | null;
  full: number | null;
  basis: "temporary_grade_policy" | "classroom_capacity" | "unavailable";
}

/** 用户确认的首版机构口径；后续机构设置落表后，此函数只保留为读取失败时的回退。 */
export function resolveClassroomCapacityPolicy(
  grade: number | null,
  classroomCapacity: number | null,
): ClassroomCapacityPolicy {
  if (grade !== null && grade >= 1 && grade <= 2) {
    return { minimumOpen: 6, healthy: 12, full: 16, basis: "temporary_grade_policy" };
  }
  if (grade !== null && grade >= 3 && grade <= 6) {
    return { minimumOpen: 6, healthy: 15, full: 20, basis: "temporary_grade_policy" };
  }
  if (classroomCapacity !== null && classroomCapacity > 0) {
    return { minimumOpen: 6, healthy: null, full: classroomCapacity, basis: "classroom_capacity" };
  }
  return { minimumOpen: 6, healthy: null, full: null, basis: "unavailable" };
}

export interface ClassroomCapacityInput {
  classroomId: string;
  grade: number | null;
  classroomCapacity: number | null;
  enrolledSeats: number;
}

export interface ClassroomCapacityTotals {
  classCount: number;
  fullSeats: number | null;
  enrolledSeats: number;
  minimumOpenGap: number;
  healthyDelta: number | null;
  remainingSeats: number | null;
}

/** 差额逐班计算再合计，保证超员班不会抵消另一个尚未达到最低开班人数的班。 */
export function summarizeClassroomCapacity(
  classrooms: readonly ClassroomCapacityInput[],
): ClassroomCapacityTotals {
  let fullSeats: number | null = 0;
  let healthySeats: number | null = 0;
  let enrolledSeats = 0;
  let minimumOpenGap = 0;
  let remainingSeats: number | null = 0;

  for (const classroom of classrooms) {
    const policy = resolveClassroomCapacityPolicy(classroom.grade, classroom.classroomCapacity);
    enrolledSeats += classroom.enrolledSeats;
    minimumOpenGap += Math.max(0, policy.minimumOpen - classroom.enrolledSeats);
    if (fullSeats !== null) fullSeats = policy.full === null ? null : fullSeats + policy.full;
    if (healthySeats !== null) healthySeats = policy.healthy === null ? null : healthySeats + policy.healthy;
    if (remainingSeats !== null) {
      remainingSeats = policy.full === null
        ? null
        : remainingSeats + Math.max(0, policy.full - classroom.enrolledSeats);
    }
  }

  return {
    classCount: classrooms.length,
    fullSeats,
    enrolledSeats,
    minimumOpenGap,
    healthyDelta: healthySeats === null ? null : enrolledSeats - healthySeats,
    remainingSeats,
  };
}
