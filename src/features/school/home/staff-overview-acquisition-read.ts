import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { STAFF_OVERVIEW_READ_LIMIT, type OverviewRowsResult } from "./staff-overview-read";
import type { OverviewAcquisitionSource } from "./staff-overview-acquisition-contract";

/** 数据库合并同一来源行的增量版本；总览与明细共用，不再选择某个文件日期。 */
export async function readOverviewAcquisitions(supabase: Awaited<ReturnType<typeof createClient>>): Promise<OverviewRowsResult<OverviewAcquisitionSource>> {
  const records: OverviewAcquisitionSource[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  let revision: string | null = null;
  while (records.length < STAFF_OVERVIEW_READ_LIMIT) {
    const limit = Math.min(1000, STAFF_OVERVIEW_READ_LIMIT - records.length);
    const result = await supabase.rpc("list_current_staff_overview_acquisition_sources", {
      p_after: after ?? undefined, p_limit: limit,
    });
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
    if (revision !== null && revision !== page.revision) return { data: null, error: { message: "OVERVIEW_SOURCE_CHANGED" } };
    revision = page.revision;
    for (const row of page.records) {
      if (seen.has(row.id)) return { data: null, error: { message: "OVERVIEW_REPEATED_ACQUISITION_PAGE" } };
      seen.add(row.id); records.push(row);
    }
    if (!page.hasMore) return { data: records, error: null };
    after = page.records.at(-1)!.id;
  }
  return { data: records, error: null };
}
