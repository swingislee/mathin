import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getClassroomWorkSessions } from "./classroom-workbench-read";
import { readSchoolQueryBatches } from "./school-query-pages";
import { getTeachingRecords } from "./teaching-workbench/teaching-records-read";
import { classSessionDetailSchema, type ClassRosterSession } from "./class-roster-session-contract";

export async function getClassRosterSessions(classroomIds: string[]): Promise<ClassRosterSession[]> {
  const sessions = await getClassroomWorkSessions(classroomIds);
  const ids = sessions.map(session => session.id);
  const supabase = await createClient();
  const [attendance, reviews] = await Promise.all([
    readSchoolQueryBatches(ids, (batch, start, end) => supabase.from("session_attendance").select("session_id")
      .in("session_id", batch).order("session_id").order("student_id").range(start, end)),
    readSchoolQueryBatches(ids, (batch, start, end) => supabase.from("session_reviews").select("session_id")
      .in("session_id", batch).order("session_id").order("student_id").range(start, end)),
  ]);
  if (attendance.error || reviews.error) throw new Error("CLASS_SESSION_SUMMARY_UNAVAILABLE");
  const counts = (rows: { session_id: string }[]) => {
    const values = new Map<string, number>();
    for (const row of rows) values.set(row.session_id, (values.get(row.session_id) ?? 0) + 1);
    return values;
  };
  const marked = counts(attendance.data ?? []), reviewed = counts(reviews.data ?? []);
  return sessions.map(session => ({ ...session, attendanceCount: marked.get(session.id) ?? 0, reviewCount: reviewed.get(session.id) ?? 0 }));
}

export async function getClassSessionDetail(sessionId: string, classroomId: string, userId: string, canReview: boolean) {
  // 先由现有 RPC 核对课次可见范围，再读取编辑能力；客户端传入的班级不能改变授权范围。
  const records = await getTeachingRecords(sessionId, 1);
  if (records.session.classroomId !== classroomId) throw new Error("SESSION_NOT_FOUND");
  const supabase = await createClient();
  const [permission, heads, session] = await Promise.all([
    canReview ? supabase.rpc("can_review_session", { cid: classroomId, uid: userId }) : Promise.resolve({ data: false, error: null }),
    supabase.from("learning_result_heads").select("status").eq("session_id", sessionId).eq("kind", "session_review"),
    supabase.from("class_sessions").select("cancelled_by").eq("id", sessionId).maybeSingle(),
  ]);
  if (permission.error || heads.error || session.error || !session.data) throw new Error("CLASS_SESSION_DETAIL_UNAVAILABLE");
  const statuses = new Set((heads.data ?? []).map(row => row.status));
  const resultStatus = ["revised", "withdrawn", "published", "review"].find(status => statuses.has(status)) ?? "draft";
  return classSessionDetailSchema.parse({ records, canWriteReview: permission.data === true && !session.data.cancelled_by, resultStatus });
}
