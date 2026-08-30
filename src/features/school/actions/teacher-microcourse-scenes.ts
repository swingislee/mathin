"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, intInRange, parse, requiredText, text, uuid } from "./schemas";

const CODES = [
  ...COMMON_CODES,
  "COURSE_FAMILY_NOT_FOUND",
  "INVALID_MANAGER",
  "INVALID_ROOTS",
  "INVALID_ROOT_ORDER",
  "INVALID_SCENE",
  "INVALID_SCENE_ROOT",
  "INVALID_SCENE_PARENT",
  "INVALID_SCENE_SELECTION",
  "SCENE_NOT_FOUND",
  "SCENE_NAME_EXISTS",
  "SCENE_HAS_ACTIVE_CHILDREN",
  "SCENE_HAS_UNSELECTED_CHILDREN",
  "INVALID_DIMENSION",
  "DIMENSION_NOT_FOUND",
  "DIMENSION_VALUE_EXISTS",
  "INVALID_SCOPE_SELECTION",
  "INVALID_SCOPE_TARGET",
] as const;

const familyInput = z.object({ courseFamilyId: uuid });
const uuidList = z.array(uuid).max(100).refine((value) => new Set(value).size === value.length);

function settingsPath(courseFamilyId: string) {
  return `/dashboard/courses/${courseFamilyId}/microcourse-settings`;
}

export async function setTeacherMicrocourseSubjectManagersAction(input: {
  courseFamilyId: string;
  userIds: string[];
}): Promise<ActionResult> {
  try {
    const value = parse(familyInput.extend({ userIds: uuidList }), input);
    const { supabase } = await authorizedClient("staff.manage");
    const { error } = await supabase.rpc("set_teacher_microcourse_subject_managers", {
      p_course_family_id: value.courseFamilyId,
      p_user_ids: value.userIds,
    });
    if (error) throw new Error(error.message);
    revalidatePath(settingsPath(value.courseFamilyId));
    return { ok: true };
  } catch (error) {
    return actionError(error, CODES);
  }
}

export async function setTeacherMicrocourseSceneRootsAction(input: {
  courseFamilyId: string;
  frameworkItemCodes: string[];
}): Promise<ActionResult> {
  try {
    const value = parse(familyInput.extend({
      frameworkItemCodes: z.array(z.string().trim().min(1).max(40)).max(19)
        .refine((items) => new Set(items).size === items.length),
    }), input);
    const { supabase } = await authorizedClient("subject.microcourse.scene.manage");
    const { error } = await supabase.rpc("set_subject_microcourse_scene_roots", {
      p_course_family_id: value.courseFamilyId,
      p_codes: value.frameworkItemCodes,
    });
    if (error) throw new Error(error.message);
    revalidatePath(settingsPath(value.courseFamilyId));
    revalidatePath(`/dashboard/courses/${value.courseFamilyId}`);
    return { ok: true };
  } catch (error) {
    return actionError(error, CODES);
  }
}

export async function reorderTeacherMicrocourseSceneRootsAction(input: {
  courseFamilyId: string;
  rootIds: string[];
}): Promise<ActionResult> {
  try {
    const value = parse(familyInput.extend({ rootIds: uuidList.min(1).max(19) }), input);
    const { supabase } = await authorizedClient("subject.microcourse.scene.manage");
    const { error } = await supabase.rpc("reorder_subject_microcourse_scene_roots", {
      p_course_family_id: value.courseFamilyId,
      p_root_ids: value.rootIds,
    });
    if (error) throw new Error(error.message);
    revalidatePath(settingsPath(value.courseFamilyId));
    return { ok: true };
  } catch (error) {
    return actionError(error, CODES);
  }
}

export async function createTeacherMicrocourseSceneAction(input: {
  courseFamilyId: string;
  rootId: string;
  parentId: string | null;
  name: string;
  description: string;
}): Promise<ActionResult<string>> {
  try {
    const value = parse(familyInput.extend({
      rootId: uuid,
      parentId: uuid.nullable(),
      name: requiredText(80),
      description: text(500),
    }), input);
    const { supabase } = await authorizedClient("subject.microcourse.scene.manage");
    const { data, error } = await supabase.rpc("create_subject_microcourse_scene", {
      p_course_family_id: value.courseFamilyId,
      p_root_id: value.rootId,
      p_parent_id: nullableRpcArg(value.parentId),
      p_name: value.name,
      p_description: value.description,
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("INVALID_SCENE");
    revalidatePath(settingsPath(value.courseFamilyId));
    return { ok: true, data };
  } catch (error) {
    return actionError<string>(error, CODES);
  }
}

export async function updateTeacherMicrocourseSceneAction(input: {
  courseFamilyId: string;
  sceneId: string;
  name: string;
  description: string;
  status: "active" | "archived";
}): Promise<ActionResult> {
  try {
    const value = parse(familyInput.extend({
      sceneId: uuid,
      name: requiredText(80),
      description: text(500),
      status: z.enum(["active", "archived"]),
    }), input);
    const { supabase } = await authorizedClient("subject.microcourse.scene.manage");
    const { error } = await supabase.rpc("update_subject_microcourse_scene", {
      p_scene_id: value.sceneId,
      p_name: value.name,
      p_description: value.description,
      p_status: value.status,
    });
    if (error) throw new Error(error.message);
    revalidatePath(settingsPath(value.courseFamilyId));
    revalidatePath(`/dashboard/courses/${value.courseFamilyId}`);
    return { ok: true };
  } catch (error) {
    return actionError(error, CODES);
  }
}

export async function moveTeacherMicrocourseScenesAction(input: {
  courseFamilyId: string;
  sceneIds: string[];
  targetRootId: string;
  targetParentId: string | null;
  targetIndex: number;
}): Promise<ActionResult> {
  try {
    const value = parse(familyInput.extend({
      sceneIds: uuidList.min(1),
      targetRootId: uuid,
      targetParentId: uuid.nullable(),
      targetIndex: intInRange(0, 10_000),
    }), input);
    const { supabase } = await authorizedClient("subject.microcourse.scene.manage");
    const { error } = await supabase.rpc("move_subject_microcourse_scenes", {
      p_scene_ids: value.sceneIds,
      p_target_root_id: value.targetRootId,
      p_target_parent_id: nullableRpcArg(value.targetParentId),
      p_target_index: value.targetIndex,
    });
    if (error) throw new Error(error.message);
    revalidatePath(settingsPath(value.courseFamilyId));
    revalidatePath(`/dashboard/courses/${value.courseFamilyId}`);
    return { ok: true };
  } catch (error) {
    return actionError(error, CODES);
  }
}

const dimensionKind = z.enum(["grade_stage", "grade", "term", "class_system", "class_type"]);

export async function upsertTeacherMicrocourseDimensionAction(input: {
  kind: z.infer<typeof dimensionKind>;
  id: string | null;
  parentId: string | null;
  code: string;
  nameZh: string;
  nameEn: string;
  gradeNo: number | null;
  legacySeason: number | null;
  active: boolean;
}): Promise<ActionResult<string>> {
  try {
    const value = parse(z.object({
      kind: dimensionKind,
      id: uuid.nullable(),
      parentId: uuid.nullable(),
      code: requiredText(40),
      nameZh: requiredText(40),
      nameEn: requiredText(80),
      gradeNo: intInRange(1, 99).nullable(),
      legacySeason: intInRange(1, 4).nullable(),
      active: z.boolean(),
    }), input);
    const { supabase } = await authorizedClient("organization.profile.manage");
    const { data, error } = await supabase.rpc("upsert_organization_microcourse_dimension", {
      p_kind: value.kind,
      p_id: nullableRpcArg(value.id),
      p_parent_id: nullableRpcArg(value.parentId),
      p_code: value.code,
      p_name_zh: value.nameZh,
      p_name_en: value.nameEn,
      p_grade_no: nullableRpcArg(value.gradeNo),
      p_legacy_season: nullableRpcArg(value.legacySeason),
      p_active: value.active,
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("INVALID_DIMENSION");
    revalidatePath("/dashboard/courses", "layout");
    return { ok: true, data };
  } catch (error) {
    return actionError<string>(error, CODES);
  }
}

export async function moveTeacherMicrocourseDimensionAction(input: {
  kind: z.infer<typeof dimensionKind>;
  id: string;
  direction: -1 | 1;
}): Promise<ActionResult> {
  try {
    const value = parse(z.object({ kind: dimensionKind, id: uuid, direction: z.union([z.literal(-1), z.literal(1)]) }), input);
    const { supabase } = await authorizedClient("organization.profile.manage");
    const { error } = await supabase.rpc("move_organization_microcourse_dimension", {
      p_kind: value.kind,
      p_id: value.id,
      p_direction: value.direction,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/courses", "layout");
    return { ok: true };
  } catch (error) {
    return actionError(error, CODES);
  }
}

export async function setTeacherMicrocourseCourseScopesAction(input: {
  courseFamilyId: string;
  courseIds: string[];
  sceneIds: string[];
  gradeIds: string[];
  termIds: string[];
  classSystemIds: string[];
  classTypeIds: string[];
}): Promise<ActionResult> {
  try {
    const value = parse(familyInput.extend({
      courseIds: uuidList.min(1),
      sceneIds: uuidList,
      gradeIds: uuidList,
      termIds: uuidList,
      classSystemIds: uuidList,
      classTypeIds: uuidList,
    }), input);
    const { supabase } = await authorizedClient("subject.microcourse.scope.manage");
    const { error } = await supabase.rpc("set_teacher_microcourse_course_scopes", {
      p_course_family_id: value.courseFamilyId,
      p_course_ids: value.courseIds,
      p_scene_ids: value.sceneIds,
      p_grade_ids: value.gradeIds,
      p_term_ids: value.termIds,
      p_class_system_ids: value.classSystemIds,
      p_class_type_ids: value.classTypeIds,
    });
    if (error) throw new Error(error.message);
    revalidatePath(`/dashboard/courses/${value.courseFamilyId}`);
    revalidatePath(settingsPath(value.courseFamilyId));
    return { ok: true };
  } catch (error) {
    return actionError(error, CODES);
  }
}
