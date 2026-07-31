import type { LearningResultStatus } from "./learning-results";
import { createClient } from "@/lib/supabase/server";

export interface VideoRow {
  id: string;
  studentName: string;
  classroomName: string;
  lectureName: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewComment: string;
  reviewScore: number | null;
  note: string;
  resultHeadId: string | null;
  resultStatus: LearningResultStatus | null;
}

/**
 * 课次工作区课后 tab 的视频审阅队列（P4I-15）。
 *
 * doc22：曾经还有一个不分课次的全校队列页 /dashboard/videos，但它没有任何入口、
 * 全仓零链接指向它——课后视频审阅的真实入口一直是这里。全校页与 listReviewVideos
 * 已删除，视频审阅只在它所属的课次上下文里发生。
 */
export async function listSessionVideos(sessionId: string): Promise<VideoRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("session_videos")
    .select("id,submitted_at,reviewed_at,review_comment,review_score,note,students(name),class_sessions(title,classrooms(name))")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("submitted_at", { ascending: false })
    .returns<Array<{
      id: string;
      submitted_at: string;
      reviewed_at: string | null;
      review_comment: string;
      review_score: number | null;
      note: string;
      students: { name: string } | null;
      class_sessions: { title: string; classrooms: { name: string } | null } | null;
    }>>();
  if (error) throw new Error(error.message);
  if (!data?.length) return [];

  const { data: resultRows, error: resultError } = await supabase
    .from("learning_result_heads")
    .select("id,video_id,status")
    .eq("kind", "video_review")
    .in("video_id", data.map((row) => row.id))
    .returns<Array<{ id: string; video_id: string | null; status: LearningResultStatus }>>();
  if (resultError) throw new Error(resultError.message);
  const resultByVideo = new Map((resultRows ?? []).flatMap((row) => row.video_id ? [[row.video_id, row] as const] : []));

  return data.map((row) => {
    const result = resultByVideo.get(row.id);
    return {
      id: row.id,
      studentName: row.students?.name ?? "-",
      classroomName: row.class_sessions?.classrooms?.name ?? "-",
      lectureName: row.class_sessions?.title ?? "-",
      submittedAt: row.submitted_at,
      reviewedAt: row.reviewed_at,
      reviewComment: row.review_comment,
      reviewScore: row.review_score,
      note: row.note,
      resultHeadId: result?.id ?? null,
      resultStatus: result?.status ?? null,
    };
  });
}
