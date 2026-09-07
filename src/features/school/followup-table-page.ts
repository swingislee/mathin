import { dashboardFieldFacets, filterAndSortDashboardFields, normalizeDashboardFieldQuery,
  type DashboardFieldDefinitions, type DashboardFieldFacet, type DashboardFieldQuery } from "./dashboard-page/dashboard-table-field-contract";
import type { DashboardDateContext } from "./dashboard-page/dashboard-table-date-contract";

export const FOLLOWUP_PAGE_SIZES = [20, 50, 100] as const;
export const FOLLOWUP_DEFAULT_PAGE_SIZE = 50;
export type FollowupPageSize = (typeof FOLLOWUP_PAGE_SIZES)[number];
export interface FollowupServerFields {
  query: DashboardFieldQuery;
  facets: Record<string, DashboardFieldFacet>;
}

export function followupPageSize(value: unknown): FollowupPageSize {
  const size = Number(Array.isArray(value) ? value[0] : value);
  return FOLLOWUP_PAGE_SIZES.includes(size as FollowupPageSize) ? size as FollowupPageSize : FOLLOWUP_DEFAULT_PAGE_SIZE;
}

export function followupPage<Row>(rows: readonly Row[], requestedPage: number, pageSize: FollowupPageSize) {
  const count = rows.length;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), count, page, pageSize, totalPages };
}

export function parseFollowupFieldQuery<Row>(fields: DashboardFieldDefinitions<Row>, raw: unknown) {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try { value = raw.length <= 16_384 ? JSON.parse(raw) : null; } catch { value = null; }
  }
  return normalizeDashboardFieldQuery(fields, value);
}

/** 在权限与业务范围已经收窄的服务端集合中，先筛选/排序/计数，再截取一页。 */
export function followupFieldPage<Row>(rows: readonly Row[], fields: DashboardFieldDefinitions<Row>, rawQuery: unknown,
  context: DashboardDateContext, requestedPage: number, pageSize: FollowupPageSize) {
  const query = parseFollowupFieldQuery(fields, rawQuery);
  return { ...followupPage(filterAndSortDashboardFields(rows, fields, query, context.locale, context.timeZone), requestedPage, pageSize),
    fieldView: { query, facets: dashboardFieldFacets(rows, fields, query.filters, context.locale, context.timeZone) } satisfies FollowupServerFields };
}
