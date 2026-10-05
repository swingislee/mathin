import type { Booking, LearningSession } from "./api-types";
import { sessionTimes } from "./discovery";
import type { Locale } from "./locale";

export type ScheduleItem = {
  key: string; kind: "activity" | "session"; participantId: string;
  title: string; startsAt: string; detail: string; teacher: string;
} & ReturnType<typeof sessionTimes>;

// 周课表与月课表共用记录范围；标题相同的课程和活动仍保留各自的业务 ID。
export function scheduleItems(sessions: LearningSession[], bookings: Booking[], participantId: string,
  range: { from: string; to: string }, locale: Locale): ScheduleItem[] {
  const inRange = (row: { participantId: string; startsAt: string }) => row.participantId === participantId
    && Date.parse(row.startsAt) >= Date.parse(range.from) && Date.parse(row.startsAt) < Date.parse(range.to);
  const lessons: ScheduleItem[] = sessions.filter(inRange).map(row => ({
    key: "session-" + row.id, kind: "session", participantId: row.participantId,
    title: row.title, startsAt: row.startsAt, detail: row.classroomName, teacher: row.teacherName || "", ...sessionTimes(row),
  }));
  const activities: ScheduleItem[] = bookings.filter(row => inRange(row) && row.status !== "cancelled").map(row => ({
    key: "activity-" + row.id, kind: "activity", participantId: row.participantId,
    title: row.title[locale] || row.title.zh, startsAt: row.startsAt, detail: row.location, teacher: "",
    // 预约合同没有结束时间，保留未知，不推算活动已结束。
    ...sessionTimes({ startsAt: row.startsAt, durationMinutes: null }),
  }));
  return [...lessons, ...activities].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
