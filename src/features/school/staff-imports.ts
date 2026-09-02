import { createClient } from "@/lib/supabase/server";
import type { StaffImportBatchSummary } from "./actions/types";

interface StaffImportBatchRow {
  id: string;
  status: "validated" | "completed";
  total_rows: number;
  valid_rows: number;
  duplicate_rows: number;
  error_rows: number;
  inserted_rows: number;
  created_at: string;
  completed_at: string | null;
}

/** ImportBatch history visible to the current staff manager through RLS. */
export async function listRecentStaffImportBatches(limit = 8): Promise<StaffImportBatchSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("data_import_batches")
    .select("id,status,total_rows,valid_rows,duplicate_rows,error_rows,inserted_rows,created_at,completed_at")
    .eq("import_kind", "staff")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<StaffImportBatchRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    batchId: row.id,
    status: row.status,
    total: row.total_rows,
    valid: row.valid_rows,
    duplicates: row.duplicate_rows,
    errors: row.error_rows,
    issued: row.inserted_rows,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}
