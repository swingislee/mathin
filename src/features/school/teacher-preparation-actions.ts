"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/database.types";
import { authorizedClient } from "./actions/guards";
import { intInRange, parse, text, uuid } from "./actions/schemas";
import {
  annotationContentSchema,
  lessonPlanContentSchema,
  LESSON_PLAN_TEMPLATE_VERSION,
} from "./teacher-preparation-contract";

const annotationSchema = z.object({
  sessionId: uuid,
  pageDocId: uuid,
  content: annotationContentSchema,
  baseVersion: intInRange(0, 2_147_483_647),
});

export async function saveCoursewareAnnotationAction(input: z.input<typeof annotationSchema>): Promise<ActionResult<{
  annotationId: string;
  version: number;
  updatedAt: string;
}>> {
  try {
    const value = parse(annotationSchema, input);
    const { supabase } = await authorizedClient("courseware.overlay.edit");
    const { data, error } = await supabase.rpc("save_courseware_annotation", {
      p_session_id: value.sessionId,
      p_page_doc_id: value.pageDocId,
      p_content: value.content as unknown as Json,
      p_base_version: value.baseVersion,
    });
    if (error) throw new Error(error.message);
    const row = z.object({
      annotation_id: uuid,
      version: z.number().int().positive(),
      updated_at: z.string(),
    }).parse(data?.[0]);
    return { ok: true, data: { annotationId: row.annotation_id, version: row.version, updatedAt: row.updated_at } };
  } catch (error) {
    return actionError(error, ["VERSION_CONFLICT", "PREPARATION_LOCKED", "PAGE_NOT_IN_SESSION", "FORBIDDEN", "VALIDATION"]);
  }
}

const preparationReviewerSchema = z.object({ sessionId: uuid, reviewerId: uuid });

export async function setSessionPreparationReviewerAction(
  input: z.input<typeof preparationReviewerSchema>,
): Promise<ActionResult> {
  try {
    const value = parse(preparationReviewerSchema, input);
    const { supabase } = await authorizedClient("courseware.overlay.edit");
    const { error } = await supabase.rpc("set_session_preparation_reviewer", {
      p_session_id: value.sessionId,
      p_reviewer_id: value.reviewerId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [
      "REVIEWER_NOT_AVAILABLE",
      "REVIEWER_LOCKED_BY_SUPERVISOR",
      "PREPARATION_LOCKED",
      "FORBIDDEN",
      "VALIDATION",
    ]);
  }
}

const boardSolutionSchema = z.object({ sessionId: uuid, pageDocId: uuid });

export async function generateSolutionRecordFromBoardAction(input: z.input<typeof boardSolutionSchema>): Promise<ActionResult<{
  solutionRecordId: string;
  revision: number;
}>> {
  try {
    const value = parse(boardSolutionSchema, input);
    const { supabase } = await authorizedClient("courseware.overlay.edit");
    const { data, error } = await supabase.rpc("generate_solution_record_from_board", {
      p_session_id: value.sessionId,
      p_page_doc_id: value.pageDocId,
    });
    if (error) throw new Error(error.message);
    const row = z.object({ solution_record_id: uuid, revision: z.number().int().positive() }).parse(data?.[0]);
    return { ok: true, data: { solutionRecordId: row.solution_record_id, revision: row.revision } };
  } catch (error) {
    return actionError(error, ["ANNOTATION_REQUIRED", "PREPARATION_LOCKED", "FORBIDDEN", "VALIDATION"]);
  }
}

const lessonPlanSchema = z.object({
  sessionId: uuid,
  templateVersion: z.literal(LESSON_PLAN_TEMPLATE_VERSION),
  content: lessonPlanContentSchema,
  baseRevision: intInRange(0, 2_147_483_647),
});

export async function saveSessionLessonPlanAction(input: z.input<typeof lessonPlanSchema>): Promise<ActionResult<{
  lessonPlanId: string;
  revision: number;
  status: "draft";
  updatedAt: string;
}>> {
  try {
    const value = parse(lessonPlanSchema, input);
    const { supabase } = await authorizedClient("courseware.overlay.edit");
    const { data, error } = await supabase.rpc("save_session_lesson_plan", {
      p_session_id: value.sessionId,
      p_template_version: value.templateVersion,
      p_content: value.content as Json[],
      p_base_revision: value.baseRevision,
    });
    if (error) throw new Error(error.message);
    const row = z.object({
      lesson_plan_id: uuid,
      revision: z.number().int().positive(),
      status: z.literal("draft"),
      updated_at: z.string(),
    }).parse(data?.[0]);
    return {
      ok: true,
      data: {
        lessonPlanId: row.lesson_plan_id,
        revision: row.revision,
        status: row.status,
        updatedAt: row.updated_at,
      },
    };
  } catch (error) {
    return actionError(error, ["VERSION_CONFLICT", "PREPARATION_LOCKED", "FORBIDDEN", "VALIDATION"]);
  }
}

const submitLessonPlanSchema = z.object({
  sessionId: uuid,
  revision: intInRange(1, 2_147_483_647),
});

export async function submitSessionLessonPlanAction(input: z.input<typeof submitLessonPlanSchema>): Promise<ActionResult<{
  reviewRevision: number;
}>> {
  try {
    const value = parse(submitLessonPlanSchema, input);
    const { supabase } = await authorizedClient("courseware.overlay.edit");
    const { data, error } = await supabase.rpc("submit_session_lesson_plan", {
      p_session_id: value.sessionId,
      p_revision: value.revision,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { reviewRevision: z.number().int().positive().parse(data) } };
  } catch (error) {
    return actionError(error, ["LESSON_PLAN_REQUIRED", "VERSION_CONFLICT", "PREPARATION_LOCKED", "FORBIDDEN", "VALIDATION"]);
  }
}

const withdrawLessonPlanSchema = z.object({ sessionId: uuid });

export async function withdrawSessionLessonPlanAction(
  input: z.input<typeof withdrawLessonPlanSchema>,
): Promise<ActionResult<{ revision: number }>> {
  try {
    const value = parse(withdrawLessonPlanSchema, input);
    const { supabase } = await authorizedClient("courseware.overlay.edit");
    const { data, error } = await supabase.rpc("withdraw_session_lesson_plan", {
      p_session_id: value.sessionId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { revision: z.number().int().positive().parse(data) } };
  } catch (error) {
    return actionError(error, [
      "REVIEW_NOT_FOUND",
      "REVIEW_ALREADY_DECIDED",
      "LESSON_PLAN_REQUIRED",
      "PREPARATION_LOCKED",
      "FORBIDDEN",
      "VALIDATION",
    ]);
  }
}

const pageNoteSchema = z.object({
  sessionId: uuid,
  pageDocId: uuid,
  content: text(5_000),
});

export async function saveLessonPageNoteAction(input: z.input<typeof pageNoteSchema>): Promise<ActionResult> {
  try {
    const value = parse(pageNoteSchema, input);
    const { supabase } = await authorizedClient("courseware.overlay.edit");
    const { error } = await supabase.rpc("save_lesson_page_note", {
      p_session_id: value.sessionId,
      p_page_doc_id: value.pageDocId,
      p_content: value.content,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["LESSON_PLAN_REQUIRED", "PREPARATION_LOCKED", "PAGE_NOT_IN_SESSION", "FORBIDDEN", "VALIDATION"]);
  }
}
