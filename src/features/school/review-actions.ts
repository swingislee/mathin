"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/database.types";
import { authorizedClient } from "./actions/guards";
import { COMMON_CODES, parse, text, uuid } from "./actions/schemas";

const reviewRecordSchema = z.object({
  studentId: uuid,
  studentName: text(200),
  entryScore: z.number().min(0).max(100).nullable(),
  exitScore: z.number().min(0).max(100).nullable(),
  focus: z.number().int().min(1).max(5).nullable(),
  participation: z.number().int().min(1).max(5).nullable(),
  mastery: z.number().int().min(1).max(5).nullable(),
  comment: text(2000),
});
const saveReviewsSchema = z.object({
  sessionId: uuid,
  records: z.array(reviewRecordSchema).max(200),
});

export type ReviewRecord = z.infer<typeof reviewRecordSchema>;

export async function getReviewDrawerData(sessionId: string): Promise<{ records: ReviewRecord[] }> {
  const value = parse(uuid, sessionId);
  const { supabase } = await authorizedClient("review.write");
  const { data: session, error } = await supabase
    .from("class_sessions")
    .select("classroom_id")
    .eq("id", value)
    .single<{ classroom_id: string }>();
  if (error) throw new Error(error.message);

  const [{ data: roster, error: rosterError }, { data: reviews, error: reviewError }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("student_id,students(name)")
      .eq("classroom_id", session.classroom_id)
      .eq("status", "active")
      .returns<Array<{ student_id: string; students: { name: string } | null }>>(),
    supabase
      .from("session_reviews")
      .select("student_id,entry_score,exit_score,focus,participation,mastery,comment")
      .eq("session_id", value)
      .returns<Array<{
        student_id: string;
        entry_score: number | null;
        exit_score: number | null;
        focus: number | null;
        participation: number | null;
        mastery: number | null;
        comment: string;
      }>>(),
  ]);
  if (rosterError) throw new Error(rosterError.message);
  if (reviewError) throw new Error(reviewError.message);

  const byStudent = new Map((reviews ?? []).map((review) => [review.student_id, review]));
  return {
    records: (roster ?? []).map((row) => {
      const review = byStudent.get(row.student_id);
      return {
        studentId: row.student_id,
        studentName: row.students?.name ?? "-",
        entryScore: review?.entry_score ?? null,
        exitScore: review?.exit_score ?? null,
        focus: review?.focus ?? null,
        participation: review?.participation ?? null,
        mastery: review?.mastery ?? null,
        comment: review?.comment ?? "",
      };
    }),
  };
}

export async function saveSessionReviewsAction(
  sessionId: string,
  records: ReviewRecord[],
): Promise<ActionResult> {
  try {
    const value = parse(saveReviewsSchema, { sessionId, records });
    const { supabase } = await authorizedClient("review.write");
    const { error } = await supabase.rpc("save_session_reviews_v2", {
      p_session_id: value.sessionId,
      p_records: value.records as unknown as Json,
    });
    if (error) throw new Error(error.message);

    const { data: taskRows } = await supabase
      .from("session_completion_tasks")
      .select("id,status")
      .eq("session_id", value.sessionId)
      .eq("kind", "reviews")
      .returns<Array<{ id: string; status: string }>>();
    for (const task of taskRows ?? []) {
      if (task.status !== "pending") continue;
      const { error: completeError } = await supabase.rpc("complete_session_task", {
        p_task_id: task.id,
        p_status: "done",
        p_note: "",
      });
      if (completeError) console.error("complete_session_task(review) failed", completeError.message);
    }
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "STUDENT_NOT_IN_CLASS", ...COMMON_CODES]);
  }
}