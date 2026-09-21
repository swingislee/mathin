import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { STAFF_OVERVIEW_READ_LIMIT, type OverviewRowsResult } from "./staff-overview-read";
import type { OverviewAcquisitionSource } from "./staff-overview-acquisition-contract";

/** 总览与明细读取同一个有界 SQL 快照；版本合并与 RLS 在一次查询内完成。 */
export async function readOverviewAcquisitions(supabase: Awaited<ReturnType<typeof createClient>>): Promise<OverviewRowsResult<OverviewAcquisitionSource>> {
  const limit = STAFF_OVERVIEW_READ_LIMIT;
  const result = await supabase.rpc("list_current_staff_overview_acquisition_sources", { p_limit: limit });
  // 新读取能力缺失时显示不可用，避免退回旧批次并呈现错误的完整统计。
  if (result.error) return { data: null, error: result.error };
  const page = result.data as { records?: OverviewAcquisitionSource[]; hasMore?: boolean; revision?: string } | null;
  if (!Array.isArray(page?.records) || typeof page.hasMore !== "boolean" || typeof page.revision !== "string" || !page.revision || page.records.length > limit
    || page.hasMore && page.records.length !== limit
    || page.records.some(row => typeof row?.id !== "string" || !row.id || !Array.isArray(row.record_data?.cells)
      || row.lead_id !== null && typeof row.lead_id !== "string"
      || !Array.isArray(row.source_alias_ids) || !row.source_alias_ids.includes(row.id)
      || row.source_alias_ids.some(id => typeof id !== "string" || !id))) {
    return { data: null, error: { message: "OVERVIEW_INVALID_ACQUISITION_PAGE" } };
  }
  const seen = new Set<string>();
  for (const row of page.records) {
    if (seen.has(row.id)) return { data: null, error: { message: "OVERVIEW_REPEATED_ACQUISITION_PAGE" } };
    seen.add(row.id);
  }
  // 到达上限时沿用总览的完整性判断，呈现截断状态，不把不完整数字当作总数。
  return { data: page.records, error: null };
}
