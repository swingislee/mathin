import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();

export const teacherMicrocourseCatalogCourseSchema = z.object({
  course: z.object({
    id: uuid,
    familyId: uuid,
    title: z.string(),
    description: z.string(),
    status: z.enum(["draft", "enabled", "disabled"]),
    createdBy: uuid,
    createdByName: z.string(),
    updatedAt: z.string(),
    defaultCommitId: uuid.nullable(),
  }),
  lectures: z.array(z.object({
    id: uuid,
    no: z.number().int().positive(),
    name: z.string(),
    objectives: z.string(),
    status: z.enum(["draft", "active", "archived"]),
    currentReleaseId: uuid.nullable(),
    releaseNo: z.number().int().positive().nullable(),
    pageCount: z.number().int().nonnegative(),
  })),
  branches: z.array(z.object({
    id: uuid,
    name: z.string(),
    ownerId: uuid,
    ownerName: z.string(),
    status: z.enum(["active", "archived"]),
    sourceBranchId: uuid.nullable(),
    basedOnCommitId: uuid.nullable(),
    headCommitId: uuid.nullable(),
    proposalCount: z.number().int().nonnegative(),
    canManage: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })),
  commits: z.array(z.object({
    id: uuid,
    branchId: uuid,
    branchName: z.string(),
    commitNo: z.number().int().positive(),
    message: z.string(),
    releaseCount: z.number().int().positive(),
    status: z.literal("published"),
    createdBy: uuid,
    createdByName: z.string(),
    createdAt: z.string(),
    isDefault: z.boolean(),
  })),
  capabilities: z.object({
    canAddLecture: z.boolean(),
    canCreateBranch: z.boolean(),
    canCommit: z.boolean(),
    canSelectDefault: z.boolean(),
  }),
});

export type TeacherMicrocourseCatalogCourse = z.infer<typeof teacherMicrocourseCatalogCourseSchema>;

export const teacherMicrocourseBranchMembersSchema = z.object({
  canManage: z.boolean(),
  branches: z.array(z.object({
    branchId: uuid,
    ownerId: uuid,
    collaboratorIds: z.array(uuid),
  })),
});

export type TeacherMicrocourseBranchMembers = z.infer<typeof teacherMicrocourseBranchMembersSchema>;

export const teacherMicrocourseDuplicateReportSchema = z.object({
  canManage: z.boolean(),
  groups: z.array(z.object({
    normalizedName: z.string(),
    canonicalCourseId: uuid,
    courses: z.array(z.object({
      courseId: uuid,
      title: z.string(),
      status: z.enum(["draft", "enabled", "disabled"]),
      isCanonical: z.boolean(),
      lectureCount: z.number().int().nonnegative(),
      createdAt: z.string(),
    })),
  })),
});

export type TeacherMicrocourseDuplicateReport = z.infer<typeof teacherMicrocourseDuplicateReportSchema>;

export async function getTeacherMicrocourseCatalogCourse(courseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_teacher_microcourse_catalog_course", {
    p_course_id: uuid.parse(courseId),
  });
  if (error) throw new Error(error.message);
  return teacherMicrocourseCatalogCourseSchema.parse(data);
}

export async function getTeacherMicrocourseBranchMembers(courseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_teacher_microcourse_branch_members", {
    p_course_id: uuid.parse(courseId),
  });
  if (error) throw new Error(error.message);
  return teacherMicrocourseBranchMembersSchema.parse(data);
}

export async function listTeacherMicrocourseDuplicateReport(courseFamilyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_teacher_microcourse_duplicate_report", {
    p_course_family_id: uuid.parse(courseFamilyId),
  });
  if (error) throw new Error(error.message);
  return teacherMicrocourseDuplicateReportSchema.parse(data);
}
