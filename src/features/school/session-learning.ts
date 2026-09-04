import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { collectPostgrestRowsInBatches } from "@/lib/supabase/postgrest-batches";
import type { CoursewareTrack } from "@/features/courseware-studio/data";
import { getSessionRoster } from "@/features/classroom/roster-server";
import { courseware_template_array_schema } from "./courseware-overlay";
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

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function learningCheckPagesRpcUnavailable(error: { code?: string; message?: string }): boolean {
  const message = error.message ?? "";
  return message.includes("get_session_courseware_learning_check_pages")
    && (error.code === "PGRST202" || message.includes("schema cache"));
}

async function getSessionCoursewareLearningCheckPagesFromRelease(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
): Promise<CoursewareLearningCheckPage[]> {
  const { data: session, error: sessionError } = await supabase
    .from("class_sessions")
    .select("lecture_id,courseware_track_override,courseware_resolved,classrooms(courseware_track)")
    .eq("id", sessionId)
    .maybeSingle<{
      lecture_id: string | null;
      courseware_track_override: CoursewareTrack | null;
      courseware_resolved: unknown;
      classrooms: { courseware_track: CoursewareTrack } | null;
    }>();
  if (sessionError) throw new Error(sessionError.message);
  if (!session?.lecture_id) return [];

  const track = session.courseware_track_override ?? session.classrooms?.courseware_track ?? "native-16x9";
  const resolved = record(session.courseware_resolved);
  let releaseId = typeof resolved?.releaseId === "string" ? resolved.releaseId : null;
  if (!releaseId) {
    const { data: head, error: headError } = await supabase
      .from("cw_lecture_track_heads")
      .select("current_release_id")
      .eq("lecture_id", session.lecture_id)
      .eq("track", track)
      .maybeSingle<{ current_release_id: string | null }>();
    if (headError) throw new Error(headError.message);
    releaseId = head?.current_release_id ?? null;
  }
  if (!releaseId) return [];

  const { data: release, error: releaseError } = await supabase
    .from("cw_lecture_releases")
    .select("snapshot,courseware_pages")
    .eq("id", releaseId)
    .eq("lecture_id", session.lecture_id)
    .eq("track", track)
    .maybeSingle<{ snapshot: unknown; courseware_pages: unknown }>();
  if (releaseError) throw new Error(releaseError.message);
  if (!Array.isArray(release?.snapshot)) return [];
  const releasePages = courseware_template_array_schema.parse(release.courseware_pages);

  return release.snapshot.flatMap((raw, snapshotIndex) => {
    const item = record(raw);
    if (!item || typeof item.pageDocId !== "string") return [];
    const page = releasePages[snapshotIndex];
    if (!page || page.type !== "doc" || page.docId !== item.pageDocId) return [];
    return [{
      pageDocId: item.pageDocId,
      pageNo: snapshotIndex + 1,
      title: page.title,
      learningCheckEnabled: item.learningCheckEnabled === true,
    }];
  });
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
  if (error) {
    if (!learningCheckPagesRpcUnavailable(error)) throw new Error(error.message);
    // 滚动发布或 schema cache 漂移时，正式课程仍可沿旧的 RLS 只读链加载，
    // 避免一个可选的备课元数据读取阻断整个课次工作区与课堂入口。
    return getSessionCoursewareLearningCheckPagesFromRelease(supabase, sessionId);
  }

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
