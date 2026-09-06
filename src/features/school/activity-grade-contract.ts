import type { InvitationActivityOption } from "./invitation-contract";
import { ASSESSMENT_TIME_ZONE } from "./invitation-contract";
import { calendarDayKey, zonedDateParts } from "./schedule";

export const ACTIVITY_TARGET_GRADES = Array.from({ length: 12 }, (_, index) => index + 1);

export function activityGradeFit(targetGrades: readonly number[] | null | undefined, grade: number | null | undefined): "match" | "unknown" | "mismatch" {
  if (!targetGrades) return "unknown";
  if (targetGrades.length === 0) return "match";
  if (grade == null) return "unknown";
  return targetGrades.includes(grade) ? "match" : "mismatch";
}

export function activityWeekCell(activity: Pick<InvitationActivityOption, "scheduledAt">): { day: string; period: "morning" | "afternoon" | "evening" } {
  const date = new Date(activity.scheduledAt);
  const { hour } = zonedDateParts(date, ASSESSMENT_TIME_ZONE);
  return { day: calendarDayKey(date, ASSESSMENT_TIME_ZONE), period: hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening" };
}
