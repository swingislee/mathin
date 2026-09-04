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
  grain: StaffOverviewGrain;
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

/** 当前自然周/月截至此刻，并与上一自然周期的同一进度比较。 */
export function buildStaffOverviewWindow(
  grain: StaffOverviewGrain,
  now: Date,
  timeZone: string,
): StaffOverviewWindow {
  const currentStart = grain === "week" ? startOfWeek(now, timeZone) : startOfMonth(now, timeZone);
  const currentEnd = grain === "week"
    ? addCalendarDays(currentStart, 7, timeZone)
    : monthStartOffset(currentStart, 1, timeZone);
  const previousStart = grain === "week"
    ? addCalendarDays(currentStart, -7, timeZone)
    : monthStartOffset(currentStart, -1, timeZone);
  const previousEnd = currentStart;
  const currentCutoff = now < currentEnd ? now : currentEnd;
  const previousCutoff = grain === "week"
    ? new Date(Math.min(previousEnd.getTime(), previousStart.getTime() + (currentCutoff.getTime() - currentStart.getTime())))
    : previousMonthComparableCutoff(currentCutoff, previousStart, previousEnd, timeZone);

  return {
    grain,
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
  /** 同一业务对象在同一周期只计一次时使用，例如反复进入“已确认”的邀约。 */
  id?: string;
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

export interface StaffOverviewEnrollmentOutcomeEvent {
  id: string;
  studentId: string;
  at: string;
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
 * 将发生事实放入本期/上期的日历日桶。未来日期为 null，已经过但无记录的日期为 0；
 * 两者在图上含义不同，不能把“尚未发生”画成“发生了 0 次”。
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

  window.currentDays.forEach((day, index) => {
    if (day < window.currentCutoff) currentValues[index] = 0;
  });
  window.previousDays.forEach((day, index) => {
    if (day < window.previousCutoff) previousValues[index] = 0;
  });

  const seen = new Set<string>();
  let current = 0;
  let previous = 0;
  for (const event of events) {
    const instant = new Date(event.at);
    if (Number.isNaN(instant.getTime())) continue;
    const inCurrent = instant >= window.currentStart && instant < window.currentCutoff;
    const inPrevious = instant >= window.previousStart && instant < window.previousCutoff;
    if (!inCurrent && !inPrevious) continue;
    const period = inCurrent ? "current" : "previous";
    if (uniquePerPeriod && event.id) {
      const uniqueKey = `${period}:${event.id}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
    }
    const index = (inCurrent ? currentIndex : previousIndex).get(calendarDayKey(instant, timeZone));
    if (index === undefined) continue;
    if (inCurrent) {
      current += 1;
      currentValues[index] = (currentValues[index] ?? 0) + 1;
    } else {
      previous += 1;
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
    const instant = new Date(event.at);
    if (Number.isNaN(instant.getTime())) continue;
    const inCurrent = instant >= window.currentStart && instant < window.currentCutoff;
    const inPrevious = instant >= window.previousStart && instant < window.previousCutoff;
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
 * 报名只计算参与发生后、该比较周期截止点之前的报名，保证本期与上期使用同样的时间进度。
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

  for (const period of ["current", "previous"] as const) {
    const cutoff = period === "current" ? window.currentCutoff : window.previousCutoff;
    summary.totalParticipants[period] = cohorts[period].size;

    for (const [studentId, cohort] of cohorts[period]) {
      const enrollmentInstants = enrollmentsByStudent.get(studentId) ?? [];
      const enrolledAfterParticipation = enrollmentInstants.some((instant) => (
        instant >= cohort.firstAt && instant < cutoff
      ));
      if (enrolledAfterParticipation) summary.totalEnrollments[period] += 1;
      if (cohort.teacherFirstAt.size === 0) summary.unattributedParticipants[period] += 1;

      for (const [teacherId, teacherFirstAt] of cohort.teacherFirstAt) {
        const teacher = teachers.get(teacherId) ?? {
          teacherId,
          participants: { current: 0, previous: 0 },
          enrollments: { current: 0, previous: 0 },
        };
        teacher.participants[period] += 1;
        if (enrollmentInstants.some((instant) => instant >= teacherFirstAt && instant < cutoff)) {
          teacher.enrollments[period] += 1;
        }
        teachers.set(teacherId, teacher);
      }
    }
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
