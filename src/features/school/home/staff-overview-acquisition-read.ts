import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { readOverviewRows, type OverviewRowsResult } from "./staff-overview-read";
import { OVERVIEW_ACQUISITION_FIELDS, OVERVIEW_ACQUISITION_SOURCE, OVERVIEW_ACQUISITION_TABLE, projectedOverviewAcquisition, type OverviewAcquisitionSource } from "./staff-overview-acquisition-contract";

/** 原始档案包含大量单元格元数据；总览仅传输计数与身份展示需要的四个文本字段。 */
export async function readOverviewAcquisitions(supabase: Awaited<ReturnType<typeof createClient>>): Promise<OverviewRowsResult<OverviewAcquisitionSource>> {
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
