import type { LeadPoolFilters } from "./lead-contract";
import type { PlacementClassroom } from "./enrollment-workflow-contract";
import { renewalResult, type RenewalPayment } from "./renewal-workbench-contract";

export const LEAD_WORK_FILTERS = ["unassigned", "assigned", "all"] as const;
export function leadWorkFilter(filters: LeadPoolFilters): typeof LEAD_WORK_FILTERS[number] {
  return filters.scope === "unassigned" ? "unassigned" : filters.assignment === "assigned" ? "assigned" : "all";
}

/** 保留服务器搜索与分页大小；范围变化重新从第一页选择名单。 */
export function leadWorkFilterQuery(filters: LeadPoolFilters, view: typeof LEAD_WORK_FILTERS[number], scope = filters.scope) {
  const query = new URLSearchParams({ scope: view === "unassigned" ? "unassigned" : scope === "mine" || scope === "group" ? scope : "all", pageSize: String(filters.pageSize) });
  if (view === "assigned") query.set("assignment", "assigned");
  if (filters.status) query.set("status", filters.status);
  if (filters.q) query.set("q", filters.q);
  return query.toString();
}

export const PLACEMENT_WORK_FILTERS = ["pending", "vacancies", "full", "all"] as const;
export type PlacementWorkFilter = typeof PLACEMENT_WORK_FILTERS[number];
export function placementClassMatchesWorkFilter(classroom: Pick<PlacementClassroom, "capacity" | "activeCount">, filter: PlacementWorkFilter) {
  const hasVacancies = classroom.capacity === null || classroom.activeCount < classroom.capacity;
  return filter === "vacancies" ? hasVacancies : filter === "full" ? !hasVacancies : true;
}

export const RENEWAL_WORK_FILTERS = ["uncontacted", "following", "payment", "paid", "deferred", "all"] as const;
export type RenewalWorkFilter = typeof RENEWAL_WORK_FILTERS[number];
export function renewalMatchesWorkFilter(row: { stage: string; payment?: RenewalPayment | null; recordState?: string }, filter: RenewalWorkFilter) {
  if (filter === "all") return true;
  // 往期结果及未知结果不进入当前催办队列，尤其不推断欠费。
  if (row.recordState === "historical" || row.stage === "unknown") return false;
  const result = renewalResult(row.stage, row.payment);
  if (filter === "uncontacted") return result === "unprepared";
  if (filter === "following") return result === "considering" || result === "payment_pending";
  if (filter === "payment") return result === "registered";
  if (filter === "paid") return result === "paid";
  return result === "not_enrolled" || result === "nurturing";
}
