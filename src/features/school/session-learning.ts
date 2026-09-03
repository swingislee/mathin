import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { collectPostgrestRowsInBatches } from "@/lib/supabase/postgrest-batches";
import { getSessionRoster } from "@/features/classroom/roster-server";
import type {
  CoursewareLearningCheckPage,
  LearningCheckStatus,
  SessionLearningSetup,
} from "./session-learning-contract";

export async function getSessionLearningSetup(sessionId: string): Promise<SessionLearningSetup> {
  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("class_sessions")
    .select("learning_checks_configured_at")
    .eq("id", sessionId)
    .maybeSingle<{ learning_checks_configured_at: string | null }>();
  if (sessionError) throw new Error(sessionError.message);
  if (!session) throw new Error("SESSION_NOT_FOUND");

  const [
    { data: checkRows, error: checkError },
    rosterState,
  ] = await Promise.all([
    supabase
      .from("session_learning_checks")
      .select("id,position,title,source_page_doc_id")
      .eq("session_id", sessionId)
      .order("position", { ascending: true })
      .returns<Array<{ id: string; position: number; title: string; source_page_doc_id: string | null }>>(),
    getSessionRoster(sessionId),
  ]);
  if (checkError) throw new Error(checkError.message);

  const checkIds = (checkRows ?? []).map((row) => row.id);
  const resultRows = await collectPostgrestRowsInBatches<string, {
    check_id: string;
    student_id: string;
    status: Exclude<LearningCheckStatus, "unchecked">;
  }>(checkIds, (batch) => supabase
    .from("session_learning_check_results")
    .select("check_id,student_id,status")
    .in("check_id", batch)
    .returns<Array<{
      check_id: string;
      student_id: string;
      status: Exclude<LearningCheckStatus, "unchecked">;
    }>>());

  const students = rosterState.entries.map((student) => ({
    id: student.studentId,
    name: student.name,
    seatPosition: student.seatPosition,
  }));

  return {
    configured: session.learning_checks_configured_at !== null,
    checks: (checkRows ?? []).map((row) => ({
      id: row.id,
      position: row.position,
      title: row.title,
      sourcePageId: row.source_page_doc_id,
    })),
    students,
    results: resultRows.map((row) => ({ checkId: row.check_id, studentId: row.student_id, status: row.status })),
  };
}

/**
 * 备课读取本课当前/已冻结课件的页级逐生检查标记。数据库 RPC 与课件页、
 * 标注和冻结共用同一 snapshot 解析，因此正式 release 与自由课所选方案不会分叉。
 */
export async function getSessionCoursewareLearningCheckPages(sessionId: string): Promise<CoursewareLearningCheckPage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_session_courseware_learning_check_pages", {
    p_session_id: sessionId,
  });
  if (error) throw new Error(error.message);

  const rows = z.array(z.object({
    page_doc_id: z.uuid(),
    page_no: z.number().int().positive(),
    title: z.string().min(1),
    learning_check_enabled: z.boolean(),
  })).parse(data ?? []);
  return rows.map((row) => ({
    pageDocId: row.page_doc_id,
    pageNo: row.page_no,
    title: row.title,
    learningCheckEnabled: row.learning_check_enabled,
  }));
}
