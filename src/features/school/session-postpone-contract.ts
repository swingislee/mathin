/** 顺延按机构时区的日历日计算，保持每节课的当地上课时间。 */
export const DEFAULT_SESSION_POSTPONE_DAYS = 7;
export const MAX_SESSION_POSTPONE_DAYS = 365;

export interface SessionPostponeInput {
  sessionId: string;
  days: number;
}

export interface SessionPostponePreview {
  token: string;
  classroomId: string;
  sessionId: string;
  days: number;
  timeZone: string;
  skippedCount: number;
  sessions: Array<{
    id: string;
    title: string;
    no: number | null;
    previousScheduledAt: string;
    scheduledAt: string;
    durationMin: number | null;
    roomId: string | null;
    closedDayId: string | null;
    closedDayName: string | null;
  }>;
}

export interface ApplySessionPostponeInput extends SessionPostponeInput {
  expectedToken: string;
  confirmClosedDays: boolean;
  closedDayReason: string;
}
