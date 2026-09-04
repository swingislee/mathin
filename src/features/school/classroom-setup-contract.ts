export const CLASS_SETUP_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

export type ClassSetupWeekday = (typeof CLASS_SETUP_WEEKDAYS)[number];

export interface ClassroomImportSetupContext {
  sourceSystem: string;
  sourceClassKey: string;
  sourceLabel: string;
  sourceContext: Record<string, unknown>;
  reviewIssues: Array<"course" | "teacher" | "room" | "schedule">;
  completedAt: string | null;
}

export interface ImportedClassScheduleDefaults {
  startDate: string | null;
  startTime: string | null;
  durationMin: number | null;
  weekday: ClassSetupWeekday | null;
}

const WEEKDAY_BY_LABEL: Record<string, ClassSetupWeekday> = {
  周一: 1,
  星期一: 1,
  周二: 2,
  星期二: 2,
  周三: 3,
  星期三: 3,
  周四: 4,
  星期四: 4,
  周五: 5,
  星期五: 5,
  周六: 6,
  星期六: 6,
  周日: 0,
  星期日: 0,
  星期天: 0,
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: unknown): number | null {
  const normalized = typeof value === "number" ? value : text(value);
  if (normalized === "") return null;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) ? parsed : null;
}

function sourceKeyParts(context: ClassroomImportSetupContext): string[] {
  return context.sourceClassKey.split("::").map((part) => part.trim());
}

/**
 * New imports preserve the original default-class object. Older completed
 * imports only have the stable source fingerprint, whose last two fields are
 * weekday and the original `9.12开课14:00-16:00` schedule text. Supporting
 * both keeps the repair workspace useful for batches created before the setup
 * context migration without rewriting their import facts.
 */
export function importedClassScheduleDefaults(
  context: ClassroomImportSetupContext | null,
): ImportedClassScheduleDefaults {
  if (!context) return { startDate: null, startTime: null, durationMin: null, weekday: null };

  const parts = sourceKeyParts(context);
  const source = context.sourceContext;
  const rawSchedule = text(source.time) || parts.at(-1) || "";
  const rawWeekday = text(source.weekday) || parts.at(-2) || "";
  const schoolYear = integer(source.schoolYear) ?? integer(parts[0]);
  const explicitStartDate = text(source.startDate);
  const explicitStartTime = text(source.startTime);
  const explicitDuration = integer(source.durationMin);

  const dateMatch = /(?:^|\s)(\d{1,2})[./-](\d{1,2})(?:日)?开课/.exec(rawSchedule);
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(explicitStartDate)
    ? explicitStartDate
    : schoolYear && dateMatch
      ? `${schoolYear}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`
      : null;

  const timeMatch = /(\d{1,2}):(\d{2})(?:[-~～—–至](\d{1,2}):(\d{2}))?/.exec(rawSchedule);
  const startTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(explicitStartTime)
    ? explicitStartTime
    : timeMatch
      ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`
      : null;

  let durationMin = explicitDuration && explicitDuration >= 1 && explicitDuration <= 600
    ? explicitDuration
    : null;
  if (!durationMin && timeMatch?.[3] && timeMatch[4]) {
    const start = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
    const end = Number(timeMatch[3]) * 60 + Number(timeMatch[4]);
    const difference = end - start;
    if (difference >= 1 && difference <= 600) durationMin = difference;
  }

  const weekday = WEEKDAY_BY_LABEL[rawWeekday] ?? null;
  return { startDate, startTime, durationMin, weekday };
}
