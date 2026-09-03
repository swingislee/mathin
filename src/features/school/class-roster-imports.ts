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

interface ClassroomOptionRow {
  id: string;
  name: string;
  grade: number | null;
  capacity: number | null;
  term_id: string | null;
  courses: { title: string; class_type: string; course_families: { slug: string } | null } | null;
  school_terms: { year: number; term: number } | null;
  default_room: { name: string; campuses: { name: string } | null } | null;
}

interface ClassroomStaffRow {
  classroom_id: string;
  responsibility: string;
  profiles: { display_name: string } | null;
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
    .from("classrooms")
    .select("id,name,grade,capacity,term_id,courses(title,class_type,course_families(slug)),school_terms(year,term),default_room:campus_rooms!classrooms_default_room_id_fkey(name,campuses(name))")
    .eq("purpose", "production")
    .in("operational_status", ["planning", "active"])
    .is("archived_at", null)
    .is("trashed_at", null)
    .order("name", { ascending: true })
    .limit(1_000)
    .returns<ClassroomOptionRow[]>();
  if (error) throw new Error(error.message);
  const classroomIds = (data ?? []).map((row) => row.id);
  if (classroomIds.length === 0) return [];

  const [{ data: staffRows, error: staffError }, { data: enrollmentRows, error: enrollmentError }] = await Promise.all([
    supabase
      .from("classroom_staff_assignments")
      .select("classroom_id,responsibility,profiles!classroom_staff_assignments_user_id_fkey(display_name)")
      .in("classroom_id", classroomIds)
      .eq("responsibility", "primary_teacher")
      .is("archived_at", null)
      .returns<ClassroomStaffRow[]>(),
    supabase
      .from("enrollments")
      .select("classroom_id")
      .in("classroom_id", classroomIds)
      .eq("status", "active")
      .limit(20_000)
      .returns<Array<{ classroom_id: string }>>(),
  ]);
  if (staffError) throw new Error(staffError.message);
  if (enrollmentError) throw new Error(enrollmentError.message);

  const teachers = new Map<string, string[]>();
  for (const row of staffRows ?? []) {
    const name = row.profiles?.display_name?.trim();
    if (!name) continue;
    teachers.set(row.classroom_id, [...(teachers.get(row.classroom_id) ?? []), name]);
  }
  const enrollmentCounts = new Map<string, number>();
  for (const row of enrollmentRows ?? []) enrollmentCounts.set(row.classroom_id, (enrollmentCounts.get(row.classroom_id) ?? 0) + 1);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    grade: row.grade,
    termId: row.term_id,
    schoolYear: row.school_terms?.year ?? null,
    season: row.school_terms?.term ?? null,
    courseTitle: row.courses?.title ?? "",
    courseFamilySlug: row.courses?.course_families?.slug ?? "",
    classType: row.courses?.class_type ?? "",
    campusName: row.default_room?.campuses?.name ?? "",
    roomName: row.default_room?.name ?? "",
    primaryTeacherNames: teachers.get(row.id) ?? [],
    capacity: row.capacity,
    activeEnrollmentCount: enrollmentCounts.get(row.id) ?? 0,
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
