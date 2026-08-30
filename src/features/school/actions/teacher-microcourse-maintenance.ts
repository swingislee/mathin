"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./guards";
import { COMMON_CODES, parse, requiredText, text, uuid } from "./schemas";

const CODES = [
  ...COMMON_CODES,
  "MICROCOURSE_FAMILY_MISSING",
  "INVALID_COURSE_NAME",
  "INVALID_DESCRIPTION",
  "INVALID_SCENE_SCOPE",
  "INVALID_GRADE_SCOPE",
  "INVALID_TERM_SCOPE",
  "INVALID_CLASS_SYSTEM_SCOPE",
  "INVALID_CLASS_TYPE_SCOPE",
  "COURSE_NOT_FOUND",
  "BRANCH_NOT_FOUND",
  "LECTURE_LIMIT",
  "ALL_LECTURES_REQUIRE_PUBLISHED_RELEASES",
  "PUBLISHED_COMMIT_REQUIRED",
  "INVALID_COLLABORATORS",
  "MAINTAINER_HAS_BRANCH",
] as const;

const uuidList = z.array(uuid).max(100).refine((items) => new Set(items).size === items.length);
const familyAndCourse = z.object({ courseFamilyId: uuid, courseId: uuid });

function browserPath(courseFamilyId: string) {
  return `/dashboard/courses/${courseFamilyId}`;
}

function detailPath(courseFamilyId: string, courseId: string) {
  return `${browserPath(courseFamilyId)}/microcourses/${courseId}`;
}

export interface CreateTeacherMicrocourseResult {
  created: boolean;
  courseId: string;
  branchId?: string;
}

export async function createTeacherMicrocourseCatalogCourseAction(input: {
  courseFamilyId: string;
  title: string;
  description: string;
  sceneIds: string[];
  gradeIds: string[];
  termIds: string[];
  classSystemIds: string[];
  classTypeIds: string[];
}): Promise<ActionResult<CreateTeacherMicrocourseResult>> {
  try {
    const value = parse(z.object({
      courseFamilyId: uuid,
      title: requiredText(120),
      description: text(1000),
      sceneIds: uuidList,
      gradeIds: uuidList,
      termIds: uuidList,
      classSystemIds: uuidList,
      classTypeIds: uuidList,
    }), input);
    const { supabase } = await authorizedClient("subject.microcourse.course.create");
    const { data, error } = await supabase.rpc("create_teacher_microcourse_catalog_course", {
      p_course_family_id: value.courseFamilyId,
      p_title: value.title,
      p_description: value.description,
      p_scene_ids: value.sceneIds,
      p_grade_ids: value.gradeIds,
      p_term_ids: value.termIds,
      p_class_system_ids: value.classSystemIds,
      p_class_type_ids: value.classTypeIds,
    });
    if (error) throw new Error(error.message);
    const result = z.object({ created: z.boolean(), courseId: uuid, branchId: uuid.optional() }).parse(data);
    revalidatePath(browserPath(value.courseFamilyId));
    return { ok: true, data: result };
  } catch (error) {
    return actionError<CreateTeacherMicrocourseResult>(error, CODES);
  }
}

export async function addTeacherMicrocourseCatalogLectureAction(input: {
  courseFamilyId: string;
  courseId: string;
  name: string;
  objectives: string;
}): Promise<ActionResult<string>> {
  try {
    const value = parse(familyAndCourse.extend({
      name: requiredText(120),
      objectives: text(1000),
    }), input);
    const { supabase } = await authorizedClient("subject.microcourse.course.create");
    const { data, error } = await supabase.rpc("add_teacher_microcourse_catalog_lecture", {
      p_course_id: value.courseId,
      p_name: value.name,
      p_objectives: value.objectives,
    });
    if (error) throw new Error(error.message);
    const lectureId = uuid.parse(data);
    revalidatePath(browserPath(value.courseFamilyId));
    revalidatePath(detailPath(value.courseFamilyId, value.courseId));
    return { ok: true, data: lectureId };
  } catch (error) {
    return actionError<string>(error, CODES);
  }
}

export async function createTeacherMicrocourseMaintenanceBranchAction(input: {
  courseFamilyId: string;
  courseId: string;
  name: string;
}): Promise<ActionResult<{ created: boolean; branchId: string }>> {
  try {
    const value = parse(familyAndCourse.extend({ name: requiredText(120) }), input);
    const { supabase } = await authorizedClient("subject.microcourse.branch.create");
    const { data, error } = await supabase.rpc("create_teacher_microcourse_maintenance_branch", {
      p_course_id: value.courseId,
      p_name: value.name,
    });
    if (error) throw new Error(error.message);
    const result = z.object({ created: z.boolean(), branchId: uuid }).parse(data);
    revalidatePath(detailPath(value.courseFamilyId, value.courseId));
    return { ok: true, data: result };
  } catch (error) {
    return actionError<{ created: boolean; branchId: string }>(error, CODES);
  }
}

export async function commitTeacherMicrocourseMaintenanceBranchAction(input: {
  courseFamilyId: string;
  courseId: string;
  branchId: string;
  message: string;
}): Promise<ActionResult<string>> {
  try {
    const value = parse(familyAndCourse.extend({ branchId: uuid, message: requiredText(500) }), input);
    const { supabase } = await authorizedClient("subject.microcourse.commit.create");
    const { data, error } = await supabase.rpc("commit_teacher_microcourse_maintenance_branch", {
      p_branch_id: value.branchId,
      p_message: value.message,
    });
    if (error) throw new Error(error.message);
    const commitId = uuid.parse(data);
    revalidatePath(browserPath(value.courseFamilyId));
    revalidatePath(detailPath(value.courseFamilyId, value.courseId));
    return { ok: true, data: commitId };
  } catch (error) {
    return actionError<string>(error, CODES);
  }
}

export async function selectTeacherMicrocourseDefaultCommitAction(input: {
  courseFamilyId: string;
  courseId: string;
  commitId: string;
  reason: string;
}): Promise<ActionResult> {
  try {
    const value = parse(familyAndCourse.extend({ commitId: uuid, reason: text(500) }), input);
    const { supabase } = await authorizedClient("subject.microcourse.default.select");
    const { error } = await supabase.rpc("select_teacher_microcourse_default_commit", {
      p_course_id: value.courseId,
      p_commit_id: value.commitId,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    revalidatePath(browserPath(value.courseFamilyId));
    revalidatePath(detailPath(value.courseFamilyId, value.courseId));
    return { ok: true };
  } catch (error) {
    return actionError(error, CODES);
  }
}

export async function setTeacherMicrocourseBranchMembersAction(input: {
  courseFamilyId: string;
  courseId: string;
  branchId: string;
  ownerId: string;
  collaboratorIds: string[];
}): Promise<ActionResult> {
  try {
    const value = parse(familyAndCourse.extend({
      branchId: uuid,
      ownerId: uuid,
      collaboratorIds: uuidList,
    }), input);
    const { supabase } = await authorizedClient("subject.microcourse.maintainer.assign");
    const { error } = await supabase.rpc("set_teacher_microcourse_branch_members", {
      p_branch_id: value.branchId,
      p_owner_id: value.ownerId,
      p_collaborator_ids: value.collaboratorIds,
    });
    if (error) throw new Error(error.message);
    revalidatePath(detailPath(value.courseFamilyId, value.courseId));
    return { ok: true };
  } catch (error) {
    return actionError(error, CODES);
  }
}

export async function selectTeacherMicrocourseDuplicateCanonicalAction(input: {
  courseFamilyId: string;
  courseId: string;
}): Promise<ActionResult> {
  try {
    const value = parse(familyAndCourse, input);
    const { supabase } = await authorizedClient("subject.microcourse.maintainer.assign");
    const { error } = await supabase.rpc("select_teacher_microcourse_duplicate_canonical", {
      p_course_id: value.courseId,
    });
    if (error) throw new Error(error.message);
    revalidatePath(browserPath(value.courseFamilyId));
    revalidatePath(`${browserPath(value.courseFamilyId)}/microcourse-settings`);
    return { ok: true };
  } catch (error) {
    return actionError(error, CODES);
  }
}
