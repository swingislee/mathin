import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CoursewareTrack } from "@/features/courseware-studio/data";
import type {
  LearningCheckStatus,
  SessionLearningSetup,
} from "./session-learning-contract";

export interface CoursewareLearningCheckPage {
  pageDocId: string;
  pageNo: number;
  title: string;

  learningCheckEnabled: boolean;
}

export async function getSessionLearningSetup(sessionId: string): Promise<SessionLearningSetup> {
  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("class_sessions")
    .select("classroom_id,learning_checks_configured_at")
    .eq("id", sessionId)
    .maybeSingle<{ classroom_id: string; learning_checks_configured_at: string | null }>();
  if (sessionError) throw new Error(sessionError.message);
  if (!session) throw new Error("SESSION_NOT_FOUND");

  const [{ data: checkRows, error: checkError }, { data: enrollmentRows, error: enrollmentError }] = await Promise.all([
    supabase
      .from("session_learning_checks")
      .select("id,position,title,source_page_doc_id")
      .eq("session_id", sessionId)
      .order("position", { ascending: true })
      .returns<Array<{ id: string; position: number; title: string; source_page_doc_id: string | null }>>(),
    supabase
      .from("enrollments")
      .select("student_id,students(name)")
      .eq("classroom_id", session.classroom_id)
      .eq("status", "active")
      .returns<Array<{ student_id: string; students: { name: string } | null }>>(),
  ]);
  if (checkError) throw new Error(checkError.message);
  if (enrollmentError) throw new Error(enrollmentError.message);

  const checkIds = (checkRows ?? []).map((row) => row.id);
  const resultRows = checkIds.length === 0
    ? []
    : (await supabase
        .from("session_learning_check_results")
        .select("check_id,student_id,status")
        .in("check_id", checkIds)
        .returns<Array<{
          check_id: string;
          student_id: string;
          status: Exclude<LearningCheckStatus, "unchecked">;
        }>>()).data ?? [];

  return {
    configured: session.learning_checks_configured_at !== null,
    checks: (checkRows ?? []).map((row) => ({
      id: row.id,
      position: row.position,
      title: row.title,
      sourcePageId: row.source_page_doc_id,
    })),
    students: (enrollmentRows ?? []).map((row) => ({ id: row.student_id, name: row.students?.name ?? "—" })),
    results: resultRows.map((row) => ({ checkId: row.check_id, studentId: row.student_id, status: row.status })),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}


/**
 * 备课读取本课当前/已冻结 release 的页级逐生检查标记。snapshot 内的 pageDocId 是稳定身份，
 * 因此增删动画或重命名不会把检查项错误套到别的课件页。
 */
export async function getSessionCoursewareLearningCheckPages(sessionId: string): Promise<CoursewareLearningCheckPage[]> {
  const supabase = await createClient();
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
    .select("snapshot")
    .eq("id", releaseId)
    .eq("lecture_id", session.lecture_id)
    .eq("track", track)
    .maybeSingle<{ snapshot: unknown }>();
  if (releaseError) throw new Error(releaseError.message);
  if (!Array.isArray(release?.snapshot)) return [];

  const snapshotPages = release.snapshot.flatMap((raw, index) => {
    const item = record(raw);
    if (!item || typeof item.pageDocId !== "string") return [];
    return [{
      pageDocId: item.pageDocId,
      snapshotIndex: index,

      learningCheckEnabled: item.learningCheckEnabled === true,
    }];
  });
  if (snapshotPages.length === 0) return [];

  const { data: pageRows, error: pageError } = await supabase
    .from("cw_page_docs")
    .select("id,page_no,title")
    .in("id", snapshotPages.map((page) => page.pageDocId))
    .returns<Array<{ id: string; page_no: number; title: string }>>();
  if (pageError) throw new Error(pageError.message);
  const pageById = new Map((pageRows ?? []).map((page) => [page.id, page]));
  return snapshotPages.flatMap((metadata) => {
    const page = pageById.get(metadata.pageDocId);
    if (!page) return [];
    return [{
      pageDocId: metadata.pageDocId,
      pageNo: page.page_no,
      title: page.title,

      learningCheckEnabled: metadata.learningCheckEnabled,
      snapshotIndex: metadata.snapshotIndex,
    }];
  }).sort((left, right) => left.snapshotIndex - right.snapshotIndex)
    .map((page) => ({
      pageDocId: page.pageDocId,
      pageNo: page.pageNo,
      title: page.title,

      learningCheckEnabled: page.learningCheckEnabled,
    }));
}
