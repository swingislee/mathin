import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  MOFAXIAO_CLASS_ROSTER_IMPORT_TEMPLATE_VERSION,
  type ClassRosterSavedMapping,
  type ClassRosterStudentOption,
  type ClassRosterTargetOption,
  type MofaxiaoClassRosterImportBatchSummary,
} from "./actions/types";

interface ImportBatchRow {
  id: string;
  status: "validated" | "completed";
  total_rows: number;
  valid_rows: number;
  duplicate_rows: number;
  skipped_rows: number;
  error_rows: number;
  inserted_rows: number;
  created_at: string;
  completed_at: string | null;
  source_file_name: string | null;
  batch_label: string | null;
}

interface ClassRosterTargetOptionRow {
  id: string;
  name: string;
  grade: number | null;
  term_id: string | null;
  school_year: number | null;
  season: number | null;
  course_title: string;
  course_family_slug: string;
  class_type: string;
  campus_name: string;
  room_name: string;
  primary_teacher_names: string[];
  capacity: number | null;
  active_enrollment_count: number;
}

export async function listRecentMofaxiaoClassRosterImportBatches(
  limit = 8,
): Promise<MofaxiaoClassRosterImportBatchSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("data_import_batches")
    .select("id,status,total_rows,valid_rows,duplicate_rows,skipped_rows,error_rows,inserted_rows,created_at,completed_at,source_file_name,batch_label")
    .eq("import_kind", "enrollments")
    .eq("template_version", MOFAXIAO_CLASS_ROSTER_IMPORT_TEMPLATE_VERSION)
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
    skipped: row.skipped_rows,
    errors: row.error_rows,
    inserted: row.inserted_rows,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

export async function listClassRosterTargetOptions(): Promise<ClassRosterTargetOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("list_mofaxiao_class_roster_target_options")
    .returns<ClassRosterTargetOptionRow[]>();
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    grade: row.grade,
    termId: row.term_id,
    schoolYear: row.school_year,
    season: row.season,
    courseTitle: row.course_title,
    courseFamilySlug: row.course_family_slug,
    courseClassType: row.class_type,
    campusName: row.campus_name,
    roomName: row.room_name,
    primaryTeacherNames: row.primary_teacher_names,
    capacity: row.capacity,
    activeEnrollmentCount: row.active_enrollment_count,
  }));
}

export async function listClassRosterStudentOptions(): Promise<ClassRosterStudentOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .select("id,name,phone,parent_phone,grade,status")
    .is("deleted_at", null)
    .order("name", { ascending: true })
    .limit(5_000)
    .returns<Array<{ id: string; name: string; phone: string; parent_phone: string; grade: number | null; status: string }>>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    parentPhone: row.parent_phone,
    grade: row.grade,
    status: row.status,
  }));
}

export async function listClassRosterSavedMappings(): Promise<ClassRosterSavedMapping[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_roster_source_mappings")
    .select("source_class_key,classroom_id")
    .eq("source_system", "mofaxiao")
    .limit(2_000)
    .returns<Array<{ source_class_key: string; classroom_id: string }>>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ sourceClassKey: row.source_class_key, classroomId: row.classroom_id }));
}
