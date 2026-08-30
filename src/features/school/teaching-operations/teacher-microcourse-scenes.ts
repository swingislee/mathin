import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();
const namedDimension = z.object({
  id: uuid,
  code: z.string(),
  nameZh: z.string(),
  nameEn: z.string(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
const classType = namedDimension;

export const teacherMicrocourseConfigurationSchema = z.object({
  canManageScenes: z.boolean(),
  canManageOrganization: z.boolean(),
  frameworkItems: z.array(z.object({
    code: z.string(),
    groupCode: z.enum(["seven_step", "six_support", "six_guarantee"]),
    labelZh: z.string(),
    labelEn: z.string(),
    defaultOrder: z.number().int(),
  })),
  roots: z.array(z.object({
    id: uuid,
    frameworkItemCode: z.string(),
    sortOrder: z.number().int(),
    enabled: z.boolean(),
    courseCount: z.number().int().nonnegative(),
    scenes: z.array(z.object({
      id: uuid,
      parentId: uuid.nullable(),
      name: z.string(),
      description: z.string(),
      sortOrder: z.number().int(),
      status: z.enum(["active", "archived"]),
      courseCount: z.number().int().nonnegative(),
    })),
  })),
  gradeStages: z.array(namedDimension),
  grades: z.array(z.object({
    id: uuid,
    gradeNo: z.number().int(),
    nameZh: z.string(),
    nameEn: z.string(),
    stageId: uuid.nullable(),
    sortOrder: z.number().int(),
    active: z.boolean(),
  })),
  terms: z.array(namedDimension.extend({ legacySeason: z.number().int().nullable() })),
  classSystems: z.array(namedDimension.extend({ classTypes: z.array(classType) })),
  subjectManagers: z.array(z.object({ userId: uuid, displayName: z.string() })),
});

export type TeacherMicrocourseConfiguration = z.infer<typeof teacherMicrocourseConfigurationSchema>;
export type TeacherMicrocourseScene = TeacherMicrocourseConfiguration["roots"][number]["scenes"][number];
export type TeacherMicrocourseDimensionKind = "grade_stage" | "grade" | "term" | "class_system" | "class_type";

export const teacherMicrocourseScopesSchema = z.array(z.object({
  courseId: uuid,
  sceneIds: z.array(uuid),
  gradeIds: z.array(uuid),
  termIds: z.array(uuid),
  classSystemIds: z.array(uuid),
  classTypeIds: z.array(uuid),
  hasLegacyScope: z.boolean(),
}));

export type TeacherMicrocourseCourseScope = z.infer<typeof teacherMicrocourseScopesSchema>[number];

export async function listTeacherMicrocourseCourseScopes(courseFamilyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_teacher_microcourse_browser_scopes", {
    p_course_family_id: uuid.parse(courseFamilyId),
  });
  if (error) throw new Error(error.message);
  return teacherMicrocourseScopesSchema.parse(data ?? []);
}

export async function getTeacherMicrocourseConfiguration(courseFamilyId: string) {
  const supabase = await createClient();
  const parsedFamilyId = uuid.parse(courseFamilyId);
  const [{ data, error }, scopes] = await Promise.all([
    supabase.rpc("list_teacher_microcourse_configuration", { p_course_family_id: parsedFamilyId }),
    listTeacherMicrocourseCourseScopes(parsedFamilyId),
  ]);
  if (error) throw new Error(error.message);
  const configuration = teacherMicrocourseConfigurationSchema.parse(data);
  const scopeByScene = new Map<string, Set<string>>();
  for (const scope of scopes) for (const sceneId of scope.sceneIds) {
    const courses = scopeByScene.get(sceneId) ?? new Set<string>();
    courses.add(scope.courseId);
    scopeByScene.set(sceneId, courses);
  }
  return {
    ...configuration,
    roots: configuration.roots.map((root) => {
      const rootCourses = new Set<string>();
      const scenes = root.scenes.map((scene) => {
        const courses = scopeByScene.get(scene.id) ?? new Set<string>();
        for (const courseId of courses) rootCourses.add(courseId);
        return { ...scene, courseCount: courses.size };
      });
      return { ...root, scenes, courseCount: rootCourses.size };
    }),
  } satisfies TeacherMicrocourseConfiguration;
}
