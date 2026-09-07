import "server-only";

import { createClient } from "@/lib/supabase/server";
import { leadSearchFilter, listLeadPool } from "./leads";
import { readSchoolQueryPages, SCHOOL_QUERY_ID_BATCH_SIZE } from "./school-query-pages";
import { followupFieldPage } from "./followup-table-page";
import type { LeadPoolFilters, LeadPoolRow } from "./lead-contract";
import type { DashboardFieldDefinitions } from "./dashboard-page/dashboard-table-field-contract";
import type { DashboardDateContext } from "./dashboard-page/dashboard-table-date-contract";

export async function listLeadIntakeFieldPage(userId: string, filters: LeadPoolFilters,
  fields: DashboardFieldDefinitions<LeadPoolRow>, raw: unknown, context: DashboardDateContext) {
  const client = await createClient();
  const result = await readSchoolQueryPages((start, end) => {
    let query = client.from("operational_leads" as "leads").select("id");
    if (filters.scope === "unassigned") query = query.is("owner_id", null);
    if (filters.scope === "mine") query = query.eq("owner_id", userId);
    if (filters.assignment === "assigned") query = query.not("owner_id", "is", null);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.q) query = query.or(leadSearchFilter(filters.q));
    return query.order("created_at", { ascending: false }).order("id", { ascending: true }).range(start, end);
  });
  if (result.error) throw new Error("LEAD_INTAKE_SCOPE_READ");
  const ids = result.data?.map(row => row.id) ?? [];
  const rows = new Map<string, LeadPoolRow>();
  // 复用业务读取器，限定四批并发；只把最终一页和权限内的字段候选传给浏览器。
  for (let start = 0; start < ids.length; start += SCHOOL_QUERY_ID_BATCH_SIZE * 4) {
    const pages = await Promise.all(Array.from({ length: 4 }, (_, offset) => {
      const batch = ids.slice(start + offset * SCHOOL_QUERY_ID_BATCH_SIZE, start + (offset + 1) * SCHOOL_QUERY_ID_BATCH_SIZE);
      return listLeadPool(userId, { ...filters, page: 1 }, batch);
    }));
    for (const page of pages) for (const row of page.leads) rows.set(row.id, row);
  }
  const ordered = ids.flatMap(id => rows.has(id) ? [rows.get(id)!] : []);
  return { ...followupFieldPage(ordered, fields, raw, context, filters.page, filters.pageSize),
    assignableIds: ordered.filter(row => row.status !== "invalid" && row.status !== "converted").map(row => row.id) };
}
