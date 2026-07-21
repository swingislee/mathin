import "server-only";

import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import type {
  CourseFamilySummary,
  CoursePurpose,
  CourseSeason,
  CourseStatus,
  CourseVariantSummary,
} from "./types";

export const COURSE_SEASONS = [
  { value: 1, labelKey: "summer" },
  { value: 2, labelKey: "autumn" },
  { value: 3, labelKey: "winter" },
  { value: 4, labelKey: "spring" },
] as const satisfies ReadonlyArray<{ value: CourseSeason; labelKey: string }>;

export interface CourseFamilyFilters {
  q?: string;
  grade?: number;
  courseSeason?: CourseSeason;
  classType?: string;
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
    const grade = number(item.grade);
    const courseSeason = number(item.courseSeason);
    const classType = string(item.classType);
    const lectureCount = number(item.lectureCount);
    const releasedLectureCount = number(item.releasedLectureCount);
    if (!id || !title || grade === null || courseSeason === null || !isCourseSeason(courseSeason)
      || classType === null || lectureCount === null || releasedLectureCount === null) continue;
    variants.push({ id, title, productCode, grade, courseSeason, classType, lectureCount, releasedLectureCount });
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
    familyStatus: familyStatus === "draft" || familyStatus === "enabled" || familyStatus === "disabled" ? familyStatus : undefined,
    variantStatus: variantStatus === "draft" || variantStatus === "enabled" || variantStatus === "disabled" ? variantStatus : undefined,
    purpose: purpose === "production" || purpose === "test" ? purpose : undefined,
    readiness: readiness === "ready" || readiness === "incomplete" ? readiness : undefined,
    page,
  };
}

export async function listCourseFamilies(filters: CourseFamilyFilters): Promise<CourseFamilyListResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_course_families", {
    p_filters: {
      q: filters.q ?? "",
      grade: filters.grade?.toString() ?? "",
      courseSeason: filters.courseSeason?.toString() ?? "",
      classType: filters.classType ?? "",
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
