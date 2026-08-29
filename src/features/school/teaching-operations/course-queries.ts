import "server-only";

import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import {
  COURSE_SEASONS,
  type CourseFamilySummary,
  type CoursePurpose,
  type CourseSeason,
  type CourseStatus,
  type CourseVariantSummary,
} from "./types";

export { COURSE_SEASONS };

export interface CourseFamilyFilters {
  q?: string;
  grade?: number;
  courseSeason?: CourseSeason;
  classType?: string;
  /** 教材年度版本 slug（如 `2026`）。跨课程族按 slug 匹配，因此只在版本命名一致时有意义。 */
  catalogVersion?: string;
  familyStatus?: CourseStatus;
  variantStatus?: CourseStatus;
  purpose?: CoursePurpose;
  readiness?: "ready" | "incomplete";
  page: number;
}

export interface CourseFamilyListItem extends CourseFamilySummary {
  classroomCount: number;
  releasedLectureCount: number;
  incompleteLectureCount: number;
}

export interface CourseFamilyListResult {
  families: CourseFamilyListItem[];
  totalCount: number;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isCourseSeason(value: number): value is CourseSeason {
  return Number.isInteger(value) && value >= 1 && value <= 4;
}

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function number(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function string(value: Json | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function parseMatchedVariants(value: Json): CourseVariantSummary[] {
  if (!Array.isArray(value)) return [];
  const variants: CourseVariantSummary[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = string(item.id);
    const title = string(item.title);
    const productCode = string(item.productCode);
    const catalogVersionSlug = string(item.catalogVersionSlug);
    const catalogVersionTitle = string(item.catalogVersionTitle);
    const supersededByCourseId = string(item.supersededByCourseId);
    const grade = number(item.grade);
    const rawCourseSeason = number(item.courseSeason);
    const courseSeason = rawCourseSeason === null ? null : isCourseSeason(rawCourseSeason) ? rawCourseSeason : undefined;
    const classType = string(item.classType);
    const lectureCount = number(item.lectureCount);
    const releasedLectureCount = number(item.releasedLectureCount);
    if (!id || !title || grade === null || courseSeason === undefined
      || classType === null || lectureCount === null || releasedLectureCount === null
      || catalogVersionSlug === null || catalogVersionTitle === null) continue;
    variants.push({
      id, title, productCode, catalogVersionSlug, catalogVersionTitle, supersededByCourseId,
      grade, courseSeason, classType, lectureCount, releasedLectureCount,
    });
  }
  return variants;
}

export function parseCourseFamilyFilters(input: Record<string, string | string[] | undefined>): CourseFamilyFilters {
  const q = first(input.q)?.trim().slice(0, 80) || undefined;
  const grade = Number(first(input.grade));
  const courseSeason = Number(first(input.courseSeason));
  const familyStatus = first(input.familyStatus);
  const variantStatus = first(input.variantStatus);
  const purpose = first(input.purpose);
  const readiness = first(input.readiness);
  const page = Math.max(1, Number(first(input.page)) || 1);
  return {
    q,
    grade: Number.isInteger(grade) && grade >= 1 && grade <= 9 ? grade : undefined,
    courseSeason: isCourseSeason(courseSeason) ? courseSeason : undefined,
    classType: first(input.classType)?.trim().slice(0, 20) || undefined,
    catalogVersion: first(input.catalogVersion)?.trim().toLowerCase().slice(0, 40) || undefined,
    familyStatus: familyStatus === "draft" || familyStatus === "enabled" || familyStatus === "disabled" ? familyStatus : undefined,
    variantStatus: variantStatus === "draft" || variantStatus === "enabled" || variantStatus === "disabled" ? variantStatus : undefined,
    purpose: purpose === "production" || purpose === "test" ? purpose : undefined,
    readiness: readiness === "ready" || readiness === "incomplete" ? readiness : undefined,
    page,
  };
}

export interface CourseCatalogVersionOption {
  slug: string;
  title: string;
}

/**
 * 课程库的跨课程族版本筛选项。
 *
 * `default` 是「该课程族尚未发生教材年度换代」的占位版本，把它列成筛选项等于让用户
 * 在两个都表示"全部"的选项之间选，因此排除。同一个 slug（如 `2026`）可能出现在多个
 * 课程族里，按 slug 去重后取首个标题。
 */
export async function listCourseCatalogVersionOptions(): Promise<CourseCatalogVersionOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("course_catalog_versions")
    .select("slug,title,sort_order")
    .neq("slug", "default")
    .order("sort_order", { ascending: true })
    .order("slug", { ascending: true });
  if (error) throw new Error(error.message);
  const bySlug = new Map<string, string>();
  for (const row of data ?? []) if (!bySlug.has(row.slug)) bySlug.set(row.slug, row.title);
  return [...bySlug].map(([slug, title]) => ({ slug, title }));
}

export async function listCourseFamilies(filters: CourseFamilyFilters): Promise<CourseFamilyListResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_course_families", {
    p_filters: {
      q: filters.q ?? "",
      grade: filters.grade?.toString() ?? "",
      courseSeason: filters.courseSeason?.toString() ?? "",
      classType: filters.classType ?? "",
      catalogVersion: filters.catalogVersion ?? "",
      familyStatus: filters.familyStatus ?? "",
      variantStatus: filters.variantStatus ?? "",
      purpose: filters.purpose ?? "",
      readiness: filters.readiness ?? "",
    },
    p_page: filters.page,
  });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const families = rows.map((row): CourseFamilyListItem => {
    const matchedVariants = parseMatchedVariants(row.matched_variants);
    return {
      id: row.id, slug: row.slug, title: row.title, publisher: row.publisher, stage: row.stage,
      subject: row.subject, edition: row.edition, purpose: row.purpose as CoursePurpose, status: row.status as CourseStatus,
      variantCount: row.variant_count, lectureCount: row.lecture_count, matchedVariants,
      classroomCount: row.classroom_count, releasedLectureCount: row.released_lecture_count,
      incompleteLectureCount: row.incomplete_lecture_count,
    };
  });
  return { families, totalCount: rows[0]?.total_count ?? 0 };
}
