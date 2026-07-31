"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./actions/guards";
import {
  COMMON_CODES,
  dateOnly,
  datetime,
  optionalUuid,
  parse,
  requiredText,
  text,
  uuid,
} from "./actions/schemas";

const headSchema = z.object({ headId: uuid });
const withdrawSchema = z.object({ headId: uuid, reason: requiredText(1000) });
const withdrawSessionSchema = z.object({ sessionId: uuid, reason: requiredText(1000) });
const reviewDecisionSchema = z.object({
  headId: uuid,
  decision: z.enum(["publish", "changes_requested"]),
  note: text(1000),
});
const stageReportSchema = z.object({
  headId: optionalUuid,
  studentId: uuid,
  termId: uuid,
  periodStart: dateOnly,
  periodEnd: dateOnly,
  title: requiredText(200),
  summary: requiredText(10000),
  teacherComment: text(5000),
  dataCutoffAt: datetime,
});

export interface SaveStageReportInput {
  headId: string | null;
  studentId: string;
  termId: string;
  periodStart: string;
  periodEnd: string;
  title: string;
  summary: string;
  teacherComment: string;
  dataCutoffAt: string;
}

export interface SavedStageReport {
  headId: string;
  revisionId: string;
  revisionNo: number;
  status: string;
}

export async function saveStageReportDraftAction(input: SaveStageReportInput): Promise<ActionResult<SavedStageReport>> {
  try {
    const value = parse(stageReportSchema, input);
    const { supabase } = await authorizedClient("review.write");
    const { data, error } = await supabase.rpc("save_stage_report_draft", {
      p_student_id: value.studentId,
      p_term_id: value.termId,
      p_period_start: value.periodStart,
      p_period_end: value.periodEnd,
      p_title: value.title,
      p_summary: value.summary,
      p_teacher_comment: value.teacherComment,
      p_data_cutoff_at: value.dataCutoffAt,
      ...(value.headId ? { p_head_id: value.headId } : {}),
    });
    if (error) throw new Error(error.message);
    const result = data?.[0];
    if (!result) throw new Error("RESULT_NOT_FOUND");
    return {
      ok: true,
      data: {
        headId: result.result_head_id,
        revisionId: result.result_revision_id,
        revisionNo: result.result_revision_no,
        status: result.result_status,
      },
    };
  } catch (error) {
    return actionError(error, [
      "TERM_NOT_FOUND",
      "STUDENT_NOT_FOUND",
      "PERIOD_OUTSIDE_TERM",
      "RESULT_SCOPE_MISMATCH",
      "RESULT_NOT_FOUND",
      ...COMMON_CODES,
    ]);
  }
}

export async function submitLearningResultReviewAction(headId: string): Promise<ActionResult> {
  try {
    const value = parse(headSchema, { headId });
    const { supabase } = await authorizedClient("review.write");
    const { error } = await supabase.rpc("submit_learning_result_review", { p_head_id: value.headId });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["RESULT_NOT_FOUND", "INVALID_STATE", ...COMMON_CODES]);
  }
}

export async function decideLearningResultReviewAction(input: {
  headId: string;
  decision: "publish" | "changes_requested";
  note: string;
}): Promise<ActionResult> {
  try {
    const value = parse(reviewDecisionSchema, input);
    const { supabase } = await authorizedClient("review.write");
    const { error } = await supabase.rpc("decide_learning_result_review", {
      p_head_id: value.headId,
      p_decision: value.decision,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["RESULT_NOT_FOUND", "INVALID_STATE", ...COMMON_CODES]);
  }
}

export async function withdrawLearningResultAction(headId: string, reason: string): Promise<ActionResult> {
  try {
    const value = parse(withdrawSchema, { headId, reason });
    const { supabase } = await authorizedClient("review.write");
    const { error } = await supabase.rpc("withdraw_learning_result", {
      p_head_id: value.headId,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["RESULT_NOT_FOUND", "INVALID_STATE", ...COMMON_CODES]);
  }
}

export async function withdrawSessionLearningResultsAction(sessionId: string, reason: string): Promise<ActionResult> {
  try {
    const value = parse(withdrawSessionSchema, { sessionId, reason });
    const { supabase } = await authorizedClient("review.write");
    const { error } = await supabase.rpc("withdraw_session_learning_results", {
      p_session_id: value.sessionId,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "INVALID_STATE", ...COMMON_CODES]);
  }
}

export async function publishSessionReviewsAction(sessionId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, sessionId);
    const { supabase } = await authorizedClient("review.write");
    const { error } = await supabase.rpc("publish_session_reviews", { p_session_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "REVIEW_NOT_FOUND", ...COMMON_CODES]);
  }
}

export async function withdrawSessionReviewsAction(sessionId: string, reason: string): Promise<ActionResult> {
  try {
    const value = parse(withdrawSessionSchema, { sessionId, reason });
    const { supabase } = await authorizedClient("review.write");
    const { error } = await supabase.rpc("withdraw_session_reviews", {
      p_session_id: value.sessionId,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "INVALID_STATE", ...COMMON_CODES]);
  }
}
export async function publishSessionVideoReviewAction(videoId: string): Promise<ActionResult<{ headId: string }>> {
  try {
    const id = parse(uuid, videoId);
    const { supabase } = await authorizedClient("video.review");
    const { data, error } = await supabase.rpc("publish_session_video_review", { p_video_id: id });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("RESULT_NOT_FOUND");
    return { ok: true, data: { headId: data } };
  } catch (error) {
    return actionError(error, [
      "VIDEO_NOT_FOUND",
      "REVIEW_REQUIRED",
      "TERM_NOT_FOUND",
      "RESULT_NOT_FOUND",
      ...COMMON_CODES,
    ]);
  }
}
