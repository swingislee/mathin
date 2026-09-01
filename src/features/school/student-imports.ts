import { createClient } from "@/lib/supabase/server";
import type { StudentImportBatchSummary } from "./actions/types";

interface StudentImportBatchRow {
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

/** 当前账号经 RLS 可见的最近学生导入批次。 */
export async function listRecentStudentImportBatches(limit = 8): Promise<StudentImportBatchSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("data_import_batches")
    .select("id,status,total_rows,valid_rows,duplicate_rows,error_rows,inserted_rows,created_at,completed_at")
    .eq("import_kind", "students")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<StudentImportBatchRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    batchId: row.id,
    status: row.status,
    total: row.total_rows,
    valid: row.valid_rows,
    duplicates: row.duplicate_rows,
    errors: row.error_rows,
    inserted: row.inserted_rows,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}
