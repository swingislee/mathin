import { STAFF_OVERVIEW_METRICS } from "./staff-overview-contract";
import type { StaffOverviewSupportFunnelRow } from "./staff-overview-data";

export interface OverviewStaffOption { userId: string; name: string }

export function staffOverviewSupportCookie(userId: string): string {
  return `mathin_overview_support_${userId}`;
}

/** 展示名单独立于事实归属；未选人员合并后仍能与机构合计核对。 */
export function selectOverviewSupportRows(
  rows: StaffOverviewSupportFunnelRow[], directory: OverviewStaffOption[], remembered?: string,
): { options: OverviewStaffOption[]; selectedIds: string[]; rows: StaffOverviewSupportFunnelRow[] } {
  const options = Array.from(new Map([
    ...directory.map(person => [person.userId, person] as const),
    ...rows.flatMap(row => row.userId ? [[row.userId, { userId: row.userId, name: row.name }] as const] : []),
  ]).values()).sort((a, b) => a.name.localeCompare(b.name));
  const validIds = new Set(options.map(person => person.userId));
  const parsed = remembered === undefined ? null : remembered === "none" ? [] : remembered.split(",");
  const selectedIds = Array.from(new Set(parsed && parsed.every(id => validIds.has(id))
    ? parsed : rows.flatMap(row => row.userId ? [row.userId] : [])));
  const selected = new Set(selectedIds);
  const visible = rows.filter(row => row.userId !== null && selected.has(row.userId));
  for (const userId of selectedIds) {
    if (visible.some(row => row.userId === userId)) continue;
    visible.push({ key: userId, userId, name: options.find(person => person.userId === userId)!.name,
      metrics: Object.fromEntries(STAFF_OVERVIEW_METRICS.map(metric => [metric, {
        current: rows.some(row => row.metrics[metric].current === null) ? null : 0,
        previous: rows.some(row => row.metrics[metric].previous === null) ? null : 0,
      }])) as StaffOverviewSupportFunnelRow["metrics"] });
  }
  const otherRows = rows.filter(row => row.userId !== null && !selected.has(row.userId));
  if (otherRows.some(row => STAFF_OVERVIEW_METRICS.some(metric => row.metrics[metric].current !== 0 || row.metrics[metric].previous !== 0))) {
    visible.push({ key: "__other__", userId: null, name: "", metrics: Object.fromEntries(STAFF_OVERVIEW_METRICS.map(metric => [metric, {
      current: otherRows.some(row => row.metrics[metric].current === null) ? null : otherRows.reduce((sum, row) => sum + row.metrics[metric].current!, 0),
      previous: otherRows.some(row => row.metrics[metric].previous === null) ? null : otherRows.reduce((sum, row) => sum + row.metrics[metric].previous!, 0),
    }])) as StaffOverviewSupportFunnelRow["metrics"] });
  }
  visible.push(...rows.filter(row => row.userId === null));
  return { options, selectedIds, rows: visible };
}
