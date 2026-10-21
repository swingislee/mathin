"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/database.types";
import { authorizedClient } from "./actions/guards";
import { COMMON_CODES, parse, text, uuid } from "./actions/schemas";
import { getTeachingSessionRecords } from "./teaching-workbench/teaching-records-read";

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

export async function getReviewDrawerData(sessionId: string): Promise<{ records: ReviewRecord[]; savedStudentIds: string[] }> {
  const value = parse(uuid, sessionId);
  const { supabase } = await authorizedClient("review.write");
  const [lesson, { data: reviews, error: reviewError }] = await Promise.all([
    getTeachingSessionRecords(value),
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
  if (reviewError) throw new Error(reviewError.message);
  // 正式课次沿用冻结/调班后的名单；已保存课评也展示，发布范围不会藏在名单之外。
  const students = new Map(lesson.students.map(student => [student.id, student.name]));
  const missing = (reviews ?? []).map(row => row.student_id).filter(id => !students.has(id));
  if (missing.length) {
    const { data, error } = await supabase.from("students").select("id,name").in("id", missing).is("deleted_at", null);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) students.set(row.id, row.name);
  }
  const byStudent = new Map((reviews ?? []).map((review) => [review.student_id, review]));
  return {
    savedStudentIds: (reviews ?? []).filter(row => students.has(row.student_id)).map(row => row.student_id),
    records: [...students].map(([studentId, studentName]) => {
      const review = byStudent.get(studentId);
      return {
        studentId,
        studentName,
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
