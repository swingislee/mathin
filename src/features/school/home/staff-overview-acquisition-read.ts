import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { STAFF_OVERVIEW_READ_LIMIT, readOverviewRows, type OverviewRowsResult } from "./staff-overview-read";
import { OVERVIEW_ACQUISITION_FIELDS, OVERVIEW_ACQUISITION_SOURCE, OVERVIEW_ACQUISITION_TABLE, projectedOverviewAcquisition, type OverviewAcquisitionSource } from "./staff-overview-acquisition-contract";

/** 数据库逐页投影来源字段，游标沿用来源 id 的稳定顺序。 */
export async function readOverviewAcquisitions(supabase: Awaited<ReturnType<typeof createClient>>): Promise<OverviewRowsResult<OverviewAcquisitionSource>> {
  const records: OverviewAcquisitionSource[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  while (records.length < STAFF_OVERVIEW_READ_LIMIT) {
    const limit = Math.min(1000, STAFF_OVERVIEW_READ_LIMIT - records.length);
    const result = await supabase.rpc("list_staff_overview_acquisition_sources", {
      p_source_file: OVERVIEW_ACQUISITION_SOURCE, p_source_table: OVERVIEW_ACQUISITION_TABLE, p_after: after ?? undefined, p_limit: limit,
    });
    // 兼容尚未安装读取迁移的目标；其他错误保持原有不可用状态。
    if (result.error?.code === "PGRST202") return readLegacyOverviewAcquisitions(supabase);
    if (result.error) return { data: null, error: result.error };
    const page = result.data as { records?: OverviewAcquisitionSource[]; hasMore?: boolean } | null;
    if (!Array.isArray(page?.records) || typeof page.hasMore !== "boolean" || page.records.length > limit
      || page.hasMore && page.records.length !== limit
      || page.records.some(row => typeof row?.id !== "string" || !row.id || !Array.isArray(row.record_data?.cells)
        || row.lead_id !== null && typeof row.lead_id !== "string")) {
      return { data: null, error: { message: "OVERVIEW_INVALID_ACQUISITION_PAGE" } };
    }
    for (const row of page.records) {
      if (seen.has(row.id)) return { data: null, error: { message: "OVERVIEW_REPEATED_ACQUISITION_PAGE" } };
      seen.add(row.id); records.push(row);
    }
    if (!page.hasMore) return { data: records, error: null };
    after = page.records.at(-1)!.id;
  }
  return { data: records, error: null };
}

/** 迁移前按列位置投影；字段布局变化时逐行补读原始档案。 */
async function readLegacyOverviewAcquisitions(supabase: Awaited<ReturnType<typeof createClient>>): Promise<OverviewRowsResult<OverviewAcquisitionSource>> {
  const query = (selection: string) => supabase.from("history_import_records").select(selection)
    .eq("source_data->>filename", OVERVIEW_ACQUISITION_SOURCE).eq("record_data->>tableName", OVERVIEW_ACQUISITION_TABLE);
  const full = "id,lead_id,record_data";
  const sample = await query(full).order("id").limit(1);
  if (sample.error) return { data: null, error: sample.error };
  if (!sample.data?.length) return { data: [], error: null };
  const first = sample.data[0] as unknown as OverviewAcquisitionSource;
  const layout = OVERVIEW_ACQUISITION_FIELDS.map(name => first.record_data?.cells?.findIndex(cell => cell.fieldName === name) ?? -1);
  if (layout.some(index => index < 0)) return readOverviewRows<OverviewAcquisitionSource>(() => query(full));

  const selection = ["id", "lead_id", ...layout.flatMap((index, field) => [
    `field${field}:record_data->cells->${index}->>fieldName`, `text${field}:record_data->cells->${index}->>text`,
  ])].join(",");
  const projected = await readOverviewRows<{ id: string; lead_id: string | null } & Record<string, unknown>>(() => query(selection));
  if (projected.error) return readOverviewRows<OverviewAcquisitionSource>(() => query(full));
  const rows = projected.data ?? [];
  const records = rows.map(projectedOverviewAcquisition);
  const missingIds = rows.filter((_, index) => !records[index]).map(row => row.id);
  const fallback = new Map<string, OverviewAcquisitionSource>();
  for (let offset = 0; offset < missingIds.length; offset += 150) {
    const result = await readOverviewRows<OverviewAcquisitionSource>(() => query(full).in("id", missingIds.slice(offset, offset + 150)));
    if (result.error) return result;
    result.data?.forEach(row => fallback.set(row.id, row));
  }
  const resolved = records.map((record, index) => record ?? fallback.get(rows[index].id));
  if (resolved.some(row => !row)) return { data: null, error: { message: "OVERVIEW_SOURCE_CHANGED" } };
  return { data: resolved as OverviewAcquisitionSource[], error: null };
}
