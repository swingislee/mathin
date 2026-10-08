import type { Booking, CalendarEntry } from "./api-types";
import { sessionTimes } from "./discovery";
import type { Locale } from "./locale";

export type CalendarItem = {
  key: string; kind: "activity" | "session"; participantId: string;
  title: string; startsAt: string; detail: string; facilitator: string;
} & ReturnType<typeof sessionTimes>;

// 周视图与月视图共用记录范围；标题相同的安排和活动仍保留各自的业务 ID。
export function calendarItems(sessions: CalendarEntry[], bookings: Booking[], participantId: string,
  range: { from: string; to: string }, locale: Locale): CalendarItem[] {
  const inRange = (row: { participantId: string; startsAt: string }) => row.participantId === participantId
    && Date.parse(row.startsAt) >= Date.parse(range.from) && Date.parse(row.startsAt) < Date.parse(range.to);
  const entries: CalendarItem[] = sessions.filter(inRange).map(row => ({
    key: "session-" + row.id, kind: "session", participantId: row.participantId,
    title: row.title, startsAt: row.startsAt, detail: row.groupName, facilitator: row.facilitatorName || "", ...sessionTimes(row),
  }));
  const activities: CalendarItem[] = bookings.filter(row => inRange(row) && row.status !== "cancelled").map(row => ({
    key: "activity-" + row.id, kind: "activity", participantId: row.participantId,
    title: row.title[locale] || row.title.zh, startsAt: row.startsAt, detail: row.location, facilitator: "",
    // 预约合同没有结束时间，保留未知，不推算活动已结束。
    ...sessionTimes({ startsAt: row.startsAt, durationMinutes: null }),
  }));
  return [...entries, ...activities].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
