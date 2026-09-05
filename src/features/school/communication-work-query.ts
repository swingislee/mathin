import { communicationDayBounds, type CommunicationWorkbenchOptions, type CommunicationWorkbenchView } from "./communication-workday-contract";

export function communicationToday() {
  return new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 工作日期与列表身份由 URL 明确指定；旧状态筛选保持独立。 */
export function parseCommunicationWorkQuery(raw: Record<string, string | string[] | undefined>, today: string, focus = false): CommunicationWorkbenchOptions {
  let date = typeof raw.date === "string" ? raw.date : today;
  try { communicationDayBounds(date); } catch { date = today; }
  const worklistId = typeof raw.worklist === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.worklist) ? raw.worklist : undefined;
  const requested = typeof raw.view === "string" ? raw.view : "day";
  const view: CommunicationWorkbenchView = focus ? "all" : ["day", "records", "unscheduled", "all", "worklist"].includes(requested) ? requested as CommunicationWorkbenchView : "day";
  return { view: view === "worklist" && !worklistId ? "day" : view, date, ...(view === "worklist" && worklistId ? { worklistId } : {}) };
}
