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
