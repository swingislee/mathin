import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  MOFAXIAO_CLASS_IMPORT_TEMPLATE_VERSION,
  type ClassImportCourseOption,
  type MofaxiaoClassImportBatchSummary,
} from "./actions/types";

interface ImportBatchRow {
  id: string;
  status: "validated" | "completed";
  total_rows: number;
  valid_rows: number;
  duplicate_rows: number;
  error_rows: number;
  inserted_rows: number;
  created_at: string;
  completed_at: string | null;
  source_file_name: string | null;
  batch_label: string | null;
}

interface CourseOptionRow {
  id: string;
  title: string;
  product_code: string | null;
  grade: number;
  term: number | null;
  class_type: string;
  course_catalog_versions: { title: string; is_current: boolean } | null;
  course_families: { slug: string; status: string; purpose: string } | null;
}

export async function listClassImportCourseOptions(): Promise<ClassImportCourseOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .select("id,title,product_code,grade,term,class_type,course_catalog_versions(title,is_current),course_families!inner(slug,status,purpose)")
    .eq("status", "enabled")
    .eq("purpose", "production")
    .eq("course_families.status", "enabled")
    .eq("course_families.purpose", "production")
    .is("trashed_at", null)
    .order("title", { ascending: true })
    .limit(1_000)
    .returns<CourseOptionRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    familySlug: row.course_families?.slug ?? "",
    title: row.title,
    productCode: row.product_code,
    catalogVersionTitle: row.course_catalog_versions?.title ?? "",
    catalogVersionCurrent: row.course_catalog_versions?.is_current ?? false,
    grade: row.grade,
    season: row.term,
    classType: row.class_type,
  }));
}

export async function listRecentMofaxiaoClassImportBatches(
  limit = 8,
): Promise<MofaxiaoClassImportBatchSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("data_import_batches")
    .select("id,status,total_rows,valid_rows,duplicate_rows,error_rows,inserted_rows,created_at,completed_at,source_file_name,batch_label")
    .eq("import_kind", "classes")
    .eq("template_version", MOFAXIAO_CLASS_IMPORT_TEMPLATE_VERSION)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<ImportBatchRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    batchId: row.id,
    status: row.status,
    fileName: row.source_file_name ?? "",
    batchLabel: row.batch_label ?? "",
    total: row.total_rows,
    valid: row.valid_rows,
    duplicates: row.duplicate_rows,
    errors: row.error_rows,
    inserted: row.inserted_rows,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}
