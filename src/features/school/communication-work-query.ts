import { communicationDayBounds, type CommunicationWorkbenchOptions, type CommunicationWorkbenchView } from "./communication-workday-contract";

export function communicationToday() {
  return new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 老师处理自己的名单，具备团队读取和分配能力的主管默认查看团队。 */
export function communicationWorkScope(requested: unknown, canViewAll: boolean, canAssign: boolean): "mine" | "all" {
  if (requested === "mine" || !canViewAll) return "mine";
  return requested === "all" || canAssign ? "all" : "mine";
}

/** 默认打开可直接联系的名单；日期仅用于主动选择的日视图。 */
export function parseCommunicationWorkQuery(raw: Record<string, string | string[] | undefined>, today: string, focus = false): CommunicationWorkbenchOptions {
  let date = typeof raw.date === "string" ? raw.date : today;
  try { communicationDayBounds(date); } catch { date = today; }
  const worklistId = typeof raw.worklist === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.worklist) ? raw.worklist : undefined;
  const requested = typeof raw.view === "string" ? raw.view : "unscheduled";
  const view: CommunicationWorkbenchView = focus ? "all" : ["day", "records", "unscheduled", "all", "worklist"].includes(requested) ? requested as CommunicationWorkbenchView : "unscheduled";
  return { view: view === "worklist" && !worklistId ? "unscheduled" : view, date, ...(view === "worklist" && worklistId ? { worklistId } : {}) };
}
