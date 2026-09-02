import { createClient } from "@/lib/supabase/server";
import type { LeadImportBatchSummary } from "./actions/types";

interface LeadImportBatchRow {
  id: string;
  status: "validated" | "completed";
  source_file_name: string | null;
  batch_label: string | null;
  total_rows: number;
  duplicate_rows: number;
  error_rows: number;
  inserted_rows: number;
  created_at: string;
  completed_at: string | null;
}

/** 当前账号经 RLS 可见的最近真实来源线索批次。 */
export async function listRecentLeadImportBatches(limit = 8): Promise<LeadImportBatchSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("data_import_batches")
    .select("id,status,source_file_name,batch_label,total_rows,duplicate_rows,error_rows,inserted_rows,created_at,completed_at")
    .eq("import_kind", "leads")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<LeadImportBatchRow[]>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const batchIds = rows.map((row) => row.id);
  const { data: reviewRows, error: reviewError } = batchIds.length > 0
    ? await supabase
        .from("lead_import_row_reviews")
        .select("batch_id")
        .in("batch_id", batchIds)
        .eq("decision", "pending")
        .limit(5_000)
    : { data: [], error: null };
  if (reviewError) throw new Error(reviewError.message);
  const reviewCounts = new Map<string, number>();
  for (const review of reviewRows ?? []) {
    reviewCounts.set(review.batch_id, (reviewCounts.get(review.batch_id) ?? 0) + 1);
  }
  return rows.map((row) => ({
    batchId: row.id,
    status: row.status,
    fileName: row.source_file_name ?? "",
    batchLabel: row.batch_label ?? row.source_file_name ?? "",
    total: row.total_rows,
    duplicates: row.duplicate_rows,
    errors: row.error_rows,
    created: row.inserted_rows,
    reviewCount: reviewCounts.get(row.id) ?? 0,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}
