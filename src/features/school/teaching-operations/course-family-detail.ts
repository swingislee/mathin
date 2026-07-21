import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { CourseSeason, CourseStatus, LectureStatus } from "./types";

const uuidSchema = z.uuid();
const courseSeasonSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const courseStatusSchema = z.enum(["draft", "enabled", "disabled"]);
const lectureStatusSchema = z.enum(["draft", "active", "archived"]);
const operationalStatusSchema = z.enum(["planning", "active", "completed"]);

const assignmentSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  userName: z.string(),
  responsibility: z.enum(["owner", "editor", "reviewer"]),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
});

const usageSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  operationalStatus: operationalStatusSchema,
  archivedAt: z.string().nullable(),
});

const detailSchema = z.object({
  family: z.object({
    id: uuidSchema,
    slug: z.string(),
    title: z.string(),
    publisher: z.string(),
    stage: z.string(),
    subject: z.string(),
    edition: z.string(),
    description: z.string(),
    coverPath: z.string().nullable(),
    purpose: z.enum(["production", "test"]),
    status: courseStatusSchema,
  }),
  variants: z.array(z.object({
    id: uuidSchema,
    title: z.string(),
    productCode: z.string().nullable(),
    grade: z.number().int().min(1).max(9),
    courseSeason: courseSeasonSchema,
    classType: z.string(),
    status: courseStatusSchema,
    purpose: z.enum(["production", "test"]),
    trashedAt: z.string().nullable(),
    lectureCount: z.number().int().nonnegative(),
    releasedLectureCount: z.number().int().nonnegative(),
    classroomCount: z.number().int().nonnegative(),
    hasRisk: z.boolean(),
  })),
  selectedVariant: z.object({
    id: uuidSchema,
    title: z.string(),
    productCode: z.string().nullable(),
    grade: z.number().int().min(1).max(9),
    courseSeason: courseSeasonSchema,
    classType: z.string(),
    status: courseStatusSchema,
    purpose: z.enum(["production", "test"]),
    updatedAt: z.string(),
  }).nullable(),
  teachingPlan: z.array(z.object({
    id: uuidSchema,
    no: z.number().int().positive(),
    name: z.string(),
    objectives: z.string(),
    status: lectureStatusSchema,
    archivedAt: z.string().nullable(),
    hasRelease: z.boolean(),
    pageCount: z.number().int().nonnegative(),
  })),
  readiness: z.object({
    lectureCount: z.number().int().nonnegative(),
    releasedLectureCount: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
  }),
  familyAssignments: z.array(assignmentSchema),
  variantAssignments: z.array(assignmentSchema),
  usage: z.array(usageSchema),
});

export interface CourseFamilyDetail {
  family: {
    id: string;
    slug: string;
    title: string;
    publisher: string;
    stage: string;
    subject: string;
    edition: string;
    description: string;
    coverPath: string | null;
    purpose: "production" | "test";
    status: CourseStatus;
  };
  variants: Array<{
    id: string;
    title: string;
    productCode: string | null;
    grade: number;
    courseSeason: CourseSeason;
    classType: string;
    status: CourseStatus;
    purpose: "production" | "test";
    trashedAt: string | null;
    lectureCount: number;
    releasedLectureCount: number;
    classroomCount: number;
    hasRisk: boolean;
  }>;
  selectedVariant: {
    id: string;
    title: string;
    productCode: string | null;
    grade: number;
    courseSeason: CourseSeason;
    classType: string;
    status: CourseStatus;
    purpose: "production" | "test";
    updatedAt: string;
  } | null;
  teachingPlan: Array<{
    id: string;
    no: number;
    name: string;
    objectives: string;
    status: LectureStatus;
    archivedAt: string | null;
    hasRelease: boolean;
    pageCount: number;
  }>;
  readiness: {
    lectureCount: number;
    releasedLectureCount: number;
    pageCount: number;
  };
  familyAssignments: Array<z.infer<typeof assignmentSchema>>;
  variantAssignments: Array<z.infer<typeof assignmentSchema>>;
  usage: Array<z.infer<typeof usageSchema>>;
}

/** 版本详情分支（`?variant=` 已解析）时的非空 selectedVariant；产品总览分支不携带它。 */
export type SelectedCourseVariant = NonNullable<CourseFamilyDetail["selectedVariant"]>;

export function isUuid(value: string | undefined): value is string {
  return Boolean(value && uuidSchema.safeParse(value).success);
}

export async function getCourseFamilyDetail(
  familyId: string,
  variantId: string | undefined,
): Promise<CourseFamilyDetail> {
  const parsedFamilyId = uuidSchema.parse(familyId);
  const parsedVariantId = variantId && uuidSchema.safeParse(variantId).success ? variantId : undefined;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_course_family_detail", {
    p_family_id: parsedFamilyId,
    p_variant_id: parsedVariantId,
  });
  if (error) throw new Error(error.message);
  return detailSchema.parse(data) as CourseFamilyDetail;
}

/** 旧 `/courses/[courseId]` 地址仅用于找到其 family；可见性仍由详情 RPC 再次核验。 */
export async function findCourseFamilyForLegacyVariant(courseId: string): Promise<string | null> {
  const parsedCourseId = uuidSchema.safeParse(courseId);
  if (!parsedCourseId.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .select("family_id")
    .eq("id", parsedCourseId.data)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.family_id ?? null;
}
