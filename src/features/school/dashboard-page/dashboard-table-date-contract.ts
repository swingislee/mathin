import { addCalendarDays, calendarDayKey, startOfWeek, zonedDateTimeToInstant } from "../schedule";

export const DASHBOARD_DATE_GRAINS = ["year", "month", "week", "day"] as const;
export type DashboardDateGrain = (typeof DASHBOARD_DATE_GRAINS)[number];
export interface DashboardDateRange { from: string; to: string }
export interface DashboardDateContext { locale: string; timeZone: string; now: number }

const instantDays = new Map<string, string>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify([locale, options]);
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    if (dateFormatters.size >= 48) dateFormatters.clear();
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

export function isDashboardDay(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 日期事实保持原日历日；时刻按机构时区落日，显示文案不参与查询。 */
export function dashboardDay(value: string | null | undefined, timeZone: string): string | null {
  if (!value) return null;
  if (isDashboardDay(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !isDashboardDay(value.slice(0, 10))) return null;
  const key = `${timeZone}|${value}`;
  const cached = instantDays.get(key);
  if (cached) return cached;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  const day = calendarDayKey(instant, timeZone);
  // 同一批行会同时被显示、筛选和生成候选项；日期缓存有界且只持有日历值。
  if (instantDays.size >= 2048) instantDays.clear();
  instantDays.set(key, day);
  return day;
}

function dayInstant(day: string, timeZone: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return zonedDateTimeToInstant({ year, month: month - 1, day: date }, timeZone);
}

export function dashboardDateSortValue(value: string | null | undefined, timeZone: string): number | null {
  const day = dashboardDay(value, timeZone);
  if (!day) return null;
  return isDashboardDay(value) ? dayInstant(day, timeZone).getTime() : Date.parse(value!);
}

export function validDashboardDateRange(value: DashboardDateRange): boolean {
  return isDashboardDay(value.from) && isDashboardDay(value.to) && value.from <= value.to;
}

/** 日期选择的两端均为业务日；服务端可直接复用这一半开时刻范围。 */
export function dashboardDateBounds(range: DashboardDateRange, timeZone: string) {
  if (!validDashboardDateRange(range)) return null;
  return {
    from: dayInstant(range.from, timeZone).toISOString(),
    until: addCalendarDays(dayInstant(range.to, timeZone), 1, timeZone).toISOString(),
  };
}

export function dashboardDateBucket(day: string, grain: DashboardDateGrain, timeZone: string): DashboardDateRange {
  if (!isDashboardDay(day)) throw new Error("INVALID_CALENDAR_DAY");
  if (grain === "day") return { from: day, to: day };
  if (grain === "year") return { from: `${day.slice(0, 4)}-01-01`, to: `${day.slice(0, 4)}-12-31` };
  if (grain === "month") {
    const last = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    return { from: `${day.slice(0, 7)}-01`, to: last.toISOString().slice(0, 10) };
  }
  const from = startOfWeek(dayInstant(day, timeZone), timeZone);
  return { from: calendarDayKey(from, timeZone), to: calendarDayKey(addCalendarDays(from, 6, timeZone), timeZone) };
}

export function formatDashboardDate(
  value: string | null | undefined,
  context: DashboardDateContext,
  options: { time?: boolean; full?: boolean } = {},
): string {
  const day = dashboardDay(value, context.timeZone);
  if (!day) return "—";
  const today = dashboardDay(new Date(context.now).toISOString(), context.timeZone)!;
  const recent = Math.abs(Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) <= 7 * 86_400_000;
  const dateOnly = isDashboardDay(value);
  const instant = dateOnly ? new Date(`${day}T12:00:00Z`) : new Date(value!);
  const timeZone = dateOnly ? "UTC" : context.timeZone;
  const label = dateFormatter(context.locale, {
    timeZone,
    year: options.full || day.slice(0, 4) !== today.slice(0, 4) ? "numeric" : undefined,
    month: context.locale.startsWith("zh") ? "numeric" : "short",
    day: "numeric",
    weekday: options.full || recent ? "short" : undefined,
  }).format(instant);
  const time = options.time && !dateOnly ? dateFormatter(context.locale, {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(instant) : "";
  return `${label}${time ? ` ${time}` : ""}${options.full && !dateOnly ? ` (${context.timeZone})` : ""}`;
}

export function dashboardDateBucketLabel(range: DashboardDateRange, grain: DashboardDateGrain, context: DashboardDateContext): string {
  if (grain === "year") return context.locale.startsWith("zh") ? `${range.from.slice(0, 4)}年` : range.from.slice(0, 4);
  if (grain === "month") {
    const currentYear = dashboardDay(new Date(context.now).toISOString(), context.timeZone)!.slice(0, 4);
    return dateFormatter(context.locale, {
      timeZone: "UTC", year: range.from.slice(0, 4) === currentYear ? undefined : "numeric", month: "long",
    }).format(new Date(`${range.from}T12:00:00Z`));
  }
  return range.from === range.to ? formatDashboardDate(range.from, context)
    : `${formatDashboardDate(range.from, context)} – ${formatDashboardDate(range.to, context)}`;
}
