import "server-only";
import { createClient } from "@/lib/supabase/server";
import { shortCourseListSchema, shortCourseMetadataSchema, type shortCourseFilters } from "./contract";

type ShortCourseRpc = (name: "list_short_courses" | "get_short_course_metadata" | "create_short_course_batch" | "get_short_course_batch_receipt", args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export async function shortCourseRpc(name: Parameters<ShortCourseRpc>[0], args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as ShortCourseRpc).call(supabase, name, args);
  if (error) throw new Error(error.message);
  return data;
}
export async function listShortCourses(filters: ReturnType<typeof shortCourseFilters>) {
  return shortCourseListSchema.parse(await shortCourseRpc("list_short_courses", {
    p_filters: { q: filters.q, batchId: filters.batchId, status: filters.status }, p_page: filters.page,
  }));
}
export async function getShortCourseMetadata(classroomId: string) {
  return shortCourseMetadataSchema.parse(await shortCourseRpc("get_short_course_metadata", { p_classroom_id: classroomId }));
}
