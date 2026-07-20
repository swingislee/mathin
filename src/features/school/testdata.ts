import "server-only";

import { createClient } from "@/lib/supabase/server";

export interface ZeroReferenceAsset {
  id: string;
  name: string;
  kind: string;
  byteCount: number;
  mime: string;
  storagePath: string;
  createdAt: string;
}

export async function listZeroReferenceAssets(): Promise<ZeroReferenceAsset[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_zero_reference_shared_assets");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row): ZeroReferenceAsset => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    byteCount: row.byte_count,
    mime: row.mime,
    storagePath: row.storage_path,
    createdAt: row.created_at,
  }));
}

export interface PurgeableCourseFamily {
  id: string;
  title: string;
  publisher: string;
  variantCount: number;
  lectureCount: number;
  releaseCount: number;
}

export async function listPurgeableCourseFamilies(): Promise<PurgeableCourseFamily[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_purgeable_course_families");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row): PurgeableCourseFamily => ({
    id: row.id,
    title: row.title,
    publisher: row.publisher,
    variantCount: row.variant_count,
    lectureCount: row.lecture_count,
    releaseCount: row.release_count,
  }));
}

export interface PurgeableClassroom {
  id: string;
  name: string;
  enrollmentCount: number;
  sessionCount: number;
  orderCount: number;
  trashedAt: string | null;
}

export async function listPurgeableClassrooms(): Promise<PurgeableClassroom[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_purgeable_classrooms");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row): PurgeableClassroom => ({
    id: row.id,
    name: row.name,
    enrollmentCount: row.enrollment_count,
    sessionCount: row.session_count,
    orderCount: row.order_count,
    trashedAt: row.trashed_at,
  }));
}
