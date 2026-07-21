"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, parse, requiredText, text, uuid } from "@/features/school/actions/schemas";

const teachingPlanSchema = z.object({
  courseId: uuid,
  baseUpdatedAt: z.string().datetime({ offset: true }),
  lectures: z.array(z.object({
    id: uuid,
    name: requiredText(100),
    objectives: text(2000),
  })).max(500),
});

const lectureIdSchema = z.object({ lectureId: uuid });
const PLAN_CODES = [
  ...COMMON_CODES,
  "COURSE_NOT_FOUND",
  "COURSE_TRASHED",
  "INVALID_TEACHING_PLAN",
  "LECTURE_NOT_FOUND",
  "LECTURE_NOT_IN_VARIANT",
  "LECTURE_ARCHIVED",
  "STALE_WRITE",
  "INVALID_TRANSITION",
] as const;

export async function saveTeachingPlanAction(input: {
  courseId: string;
  baseUpdatedAt: string;
  lectures: Array<{ id: string; name: string; objectives: string }>;
}): Promise<ActionResult<{ updatedAt: string }>> {
  try {
    const value = parse(teachingPlanSchema, input);
    const { supabase } = await authorizedClient("course.manage");
    const { data, error } = await supabase.rpc("save_teaching_plan", {
      p_course_id: value.courseId,
      p_base_updated_at: value.baseUpdatedAt,
      p_lectures: value.lectures,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { updatedAt: data } };
  } catch (error) {
    return actionError<{ updatedAt: string }>(error, PLAN_CODES);
  }
}

export async function getLectureLifecycleImpactAction(lectureId: string): Promise<ActionResult<{
  pageCount: number;
  releaseCount: number;
  classroomCount: number;
  sessionCount: number;
  objectCount: number;
}>> {
  try {
    const { lectureId: id } = parse(lectureIdSchema, { lectureId });
    const { supabase } = await authorizedClient("course.manage");
    const { data, error } = await supabase.rpc("get_lecture_lifecycle_impact", { p_lecture_id: id });
    if (error) throw new Error(error.message);
    const impact = data?.[0];
    if (!impact) throw new Error("LECTURE_NOT_FOUND");
    return {
      ok: true,
      data: {
        pageCount: impact.page_count,
        releaseCount: impact.release_count,
        classroomCount: impact.classroom_count,
        sessionCount: impact.session_count,
        objectCount: impact.object_count,
      },
    };
  } catch (error) {
    return actionError(error, PLAN_CODES);
  }
}

export async function archiveLectureAction(lectureId: string): Promise<ActionResult> {
  try {
    const { lectureId: id } = parse(lectureIdSchema, { lectureId });
    const { supabase } = await authorizedClient("course.manage");
    const { error } = await supabase.rpc("archive_lecture", { p_lecture_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, PLAN_CODES);
  }
}

export async function restoreLectureAction(lectureId: string): Promise<ActionResult> {
  try {
    const { lectureId: id } = parse(lectureIdSchema, { lectureId });
    const { supabase } = await authorizedClient("course.manage");
    const { error } = await supabase.rpc("restore_lecture", { p_lecture_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, PLAN_CODES);
  }
}

// ---------------------------------------------------------------------------
// P4I-10：版本创建/启停、责任分配。
// ---------------------------------------------------------------------------

const createVariantSchema = z.object({
  familyId: uuid,
  title: requiredText(100),
  productCode: text(40),
  grade: z.number().int().min(1).max(9),
  courseSeason: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  classType: text(20),
});

const VARIANT_CODES = [...COMMON_CODES, "COURSE_FAMILY_NOT_FOUND", "VARIANT_ALREADY_EXISTS"] as const;

export async function createCourseVariantAction(input: {
  familyId: string;
  title: string;
  productCode: string;
  grade: number;
  courseSeason: 1 | 2 | 3 | 4;
  classType: string;
}): Promise<ActionResult<string>> {
  try {
    const value = parse(createVariantSchema, input);
    const { supabase } = await authorizedClient("course.manage");
    const { data, error } = await supabase.rpc("create_course_variant", {
      p_family_id: value.familyId,
      p_title: value.title,
      p_product_code: value.productCode,
      p_grade: value.grade,
      p_course_season: value.courseSeason,
      p_class_type: value.classType,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data };
  } catch (error) {
    return actionError<string>(error, VARIANT_CODES);
  }
}

const transitionSchema = z.object({ id: uuid, target: z.enum(["draft", "enabled", "disabled"]) });

export async function transitionCourseVariantStatusAction(courseId: string, target: "draft" | "enabled" | "disabled"): Promise<ActionResult> {
  try {
    const value = parse(transitionSchema, { id: courseId, target });
    const { supabase } = await authorizedClient("course.manage");
    const { error } = await supabase.rpc("transition_course_status", { p_course_id: value.id, p_target: value.target });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [...COMMON_CODES, "COURSE_NOT_FOUND", "COURSE_TRASHED", "INVALID_TRANSITION"]);
  }
}

export async function transitionCourseFamilyStatusAction(familyId: string, target: "draft" | "enabled" | "disabled"): Promise<ActionResult> {
  try {
    const value = parse(transitionSchema, { id: familyId, target });
    const { supabase } = await authorizedClient("course.manage");
    const { error } = await supabase.rpc("transition_course_family_status", { p_family_id: value.id, p_target: value.target });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [...COMMON_CODES, "COURSE_FAMILY_NOT_FOUND", "INVALID_TRANSITION"]);
  }
}

const scopeSchema = z.object({ scopeType: z.enum(["family", "variant", "lecture"]), scopeId: uuid, userId: uuid });
const ASSIGNMENT_CODES = [
  ...COMMON_CODES,
  "INVALID_SCOPE",
  "COURSE_FAMILY_NOT_FOUND",
  "COURSE_NOT_FOUND",
  "INVALID_STAFF",
  "INVALID_RESPONSIBILITY",
  "ASSIGNMENT_ALREADY_EXISTS",
  "ASSIGNMENT_NOT_FOUND",
] as const;

export async function assignCourseOwnerAction(scopeType: "family" | "variant" | "lecture", scopeId: string, userId: string): Promise<ActionResult> {
  try {
    const value = parse(scopeSchema, { scopeType, scopeId, userId });
    const { supabase } = await authorizedClient("course.assignment.manage");
    const { error } = await supabase.rpc("assign_course_owner", {
      p_scope_type: value.scopeType,
      p_scope_id: value.scopeId,
      p_user_id: value.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ASSIGNMENT_CODES);
  }
}

const collaboratorSchema = z.object({
  scopeType: z.enum(["family", "variant", "lecture"]),
  scopeId: uuid,
  userId: uuid,
  responsibility: z.enum(["editor", "reviewer"]),
});

export async function addCourseCollaboratorAction(
  scopeType: "family" | "variant" | "lecture",
  scopeId: string,
  userId: string,
  responsibility: "editor" | "reviewer",
): Promise<ActionResult> {
  try {
    const value = parse(collaboratorSchema, { scopeType, scopeId, userId, responsibility });
    const { supabase } = await authorizedClient("course.assignment.manage");
    const { error } = await supabase.rpc("add_course_collaborator", {
      p_scope_type: value.scopeType,
      p_scope_id: value.scopeId,
      p_user_id: value.userId,
      p_responsibility: value.responsibility,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ASSIGNMENT_CODES);
  }
}

export async function removeCourseAssignmentAction(assignmentId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, assignmentId);
    const { supabase } = await authorizedClient("course.assignment.manage");
    const { error } = await supabase.rpc("remove_course_assignment", { p_assignment_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ASSIGNMENT_CODES);
  }
}
