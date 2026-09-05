export type CommunicationWorkbenchView = "day" | "records" | "unscheduled" | "all" | "worklist";
export interface CommunicationWorkbenchOptions {
  view: CommunicationWorkbenchView;
  date: string;
  worklistId?: string;
}
export interface CommunicationDayEvent {
  id: string;
  source: "contact" | "invitation" | "post_activity";
  key: string;
  occurredAt: string;
  recordedAt: string;
  recordedById: string;
  recordedByName: string;
  channel: string;
  outcome: string;
  note: string;
  revisionId: string | null;
  revisedAt: string | null;
  canRevise: boolean;
  wechatAdded?: boolean | null;
  visitCommitted?: boolean | null;
  interestLevel?: "A" | "B" | "C" | null;
  route?: string;
  nextContactAt?: string | null;
  details?: string;
}
export interface CommunicationDayTask {
  key: string;
  dueAt: string;
  createdAt: string;
  completedAt: string | null;
  kind: string;
}
export interface CommunicationWorkday {
  date: string;
  events: CommunicationDayEvent[];
  tasks: CommunicationDayTask[];
}
export interface CommunicationWorklist {
  id: string;
  name: string;
  date: string;
  ownerId: string;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
  items: { key: string; position: number; addedAt: string; completedAt: string | null }[];
  rowKeys: string[];
}

/** 上海本地日，结束边界不包含在查询中。 */
export function communicationDayBounds(date: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError("INVALID_COMMUNICATION_DATE");
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date) throw new RangeError("INVALID_COMMUNICATION_DATE");
  const start = midnight - 8 * 60 * 60 * 1000;
  return { start: new Date(start).toISOString(), end: new Date(start + 24 * 60 * 60 * 1000).toISOString() };
}

/** 当日登记与当天曾待办的事项并集；结束事项仍保留到当天结束。 */
export function communicationWorkdayKeys(workday: CommunicationWorkday): string[] {
  const { start, end } = communicationDayBounds(workday.date);
  const from = Date.parse(start);
  const until = Date.parse(end);
  const anchors = new Map<string, number>();
  const add = (key: string, at: number) => anchors.set(key, Math.min(anchors.get(key) ?? Number.POSITIVE_INFINITY, at));
  for (const task of workday.tasks) {
    if (Date.parse(task.createdAt) < until && Date.parse(task.dueAt) < until
      && (!task.completedAt || Date.parse(task.completedAt) >= from)) add(task.key, Date.parse(task.dueAt));
  }
  for (const event of workday.events) {
    const at = Date.parse(event.occurredAt);
    if (at >= from && at < until) add(event.key, at);
  }
  return [...anchors].sort(([left, leftAt], [right, rightAt]) => leftAt - rightAt || left.localeCompare(right)).map(([key]) => key);
}
