import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { readSchoolQueryBatches, readSchoolQueryPages } from "../school-query-pages";
import {
  artifactProgress, classFeedbackProgress, completionProgress, learningProgress, reflectionProgress, timedTeachingProgress,
  type TeachingProgress, type TeachingProgressMatrixData,
} from "./teaching-progress-matrix-contract";
import { preparationDueAt } from "./teaching-workbench-contract";

const factsSchema = z.array(z.object({
  sessionId: z.string().min(1),
  tasks: z.array(z.object({ kind: z.enum(["reviews", "assignment"]), status: z.string() })),
  taskTiming: z.array(z.object({ kind: z.enum(["reviews", "summary", "assignment", "followup"]), dueAt: z.string().nullable(), completedAt: z.string().nullable() })),
  learningResults: z.array(z.object({ status: z.string(), completedAt: z.string().nullable(), reviewedAt: z.string().nullable(), requiresReview: z.boolean() })),
  classFeedback: z.enum(["missing", "contacted", "follow_up", "not_needed", "unavailable"]),
  classFeedbackCompletedAt: z.string().nullable(),
  communication: z.enum(["done", "pending", "unavailable"]),
  communicationCompletedAt: z.string().nullable(),
}));

/** 同一已授权班级集合的只读投影；正文留在服务端，前端只接收身份与进度。 */
export async function getTeachingProgressMatrix({ userId, canViewTeam, canReadCommunication, termId, now = Date.now() }: {
  userId: string; canViewTeam: boolean; canReadCommunication: boolean; termId?: string; now?: number;
}): Promise<TeachingProgressMatrixData> {
  const client = await createClient();
  const classes = await readSchoolQueryPages((start, end) => {
    const query = client.from("classrooms").select("id,name,term_id,grade,room,course:courses!classrooms_course_id_fkey(title,grade,class_type),default_room:campus_rooms!classrooms_default_room_id_fkey(name,campuses(name))")
      .eq("purpose", "production").is("archived_at", null).is("trashed_at", null);
    return (termId ? query.eq("term_id", termId) : query).order("id").range(start, end);
  });
  if (classes.error) throw new Error("TEACHING_MATRIX_UNAVAILABLE");
  const classIds = (classes.data ?? []).map(row => row.id);
  if (!classIds.length) return { classrooms: [], sessions: [] };
  const [assignments, lessons] = await Promise.all([
    readSchoolQueryBatches(classIds, (batch, start, end) => client.from("classroom_staff_assignments")
      .select("classroom_id,user_id,responsibility,profile:profiles!classroom_staff_assignments_user_id_fkey(display_name)")
      .in("classroom_id", batch).in("responsibility", ["primary_teacher", "assistant_teacher"])
      .order("classroom_id").order("user_id").order("responsibility").range(start, end)),
    readSchoolQueryBatches(classIds, (batch, start, end) => client.from("class_sessions")
      .select("id,classroom_id,title,lecture_no,scheduled_at,duration_min,started_at,ended_at,teacher_override")
      .in("classroom_id", batch).is("deleted_at", null).is("voided_at", null).is("cancelled_by", null)
      .order("classroom_id").order("scheduled_at").order("id").range(start, end)),
  ]);
  if (assignments.error || lessons.error) throw new Error("TEACHING_MATRIX_UNAVAILABLE");
  const staff = assignments.data ?? [];
  const teachingAssignments = staff.filter(row => row.user_id === userId);
  const mine = new Set(teachingAssignments.map(row => row.classroom_id));
  const sessions = (lessons.data ?? []).filter(session => canViewTeam || session.teacher_override === userId || teachingAssignments.some(row =>
    row.classroom_id === session.classroom_id && (row.responsibility === "assistant_teacher" || !session.teacher_override)));
  const visibleClassIds = new Set(sessions.map(row => row.classroom_id));
  const visibleClasses = (classes.data ?? []).filter(row => canViewTeam || mine.has(row.id) || visibleClassIds.has(row.id));
  const ids = sessions.map(row => row.id);
  const [reviews, plans, facts, substitutes] = await Promise.all([
    readSchoolQueryBatches(ids, (batch, start, end) => client.from("session_preparation_reviews")
      .select("session_id,artifact_kind,status,submitted_at,reviewed_at").in("session_id", batch).order("session_id").order("artifact_kind").range(start, end)),
    readSchoolQueryBatches(ids, (batch, start, end) => client.from("lesson_plans")
      .select("session_id,content,status,updated_at").in("session_id", batch).order("session_id").range(start, end)),
    readSchoolQueryBatches(ids, async batch => {
      const result = await client.rpc("get_teaching_progress_facts", { p_session_ids: batch });
      const parsed = factsSchema.safeParse(result.data);
      return result.error || !parsed.success ? { data: null, error: { message: "TEACHING_FACTS_UNAVAILABLE" } }
        : { data: parsed.data, error: null };
    }),
    readSchoolQueryBatches(sessions.flatMap(row => row.teacher_override ? [row.teacher_override] : []), (batch, start, end) => client.from("profiles")
      .select("id,display_name").in("id", batch).order("id").range(start, end)),
  ]);
  const unavailable = (forbidden = false): TeachingProgress => ({ state: "unavailable", reason: forbidden ? "forbidden" : "failed" });
  const grouped = <T extends { session_id: string | null }>(rows: T[] | null) => {
    const map = new Map<string, T[]>();
    for (const row of rows ?? []) if (row.session_id) map.set(row.session_id, [...(map.get(row.session_id) ?? []), row]);
    return map;
  };
  const reviewMap = grouped(reviews.data), planMap = grouped(plans.data);
  const factMap = new Map((facts.data ?? []).map(row => [row.sessionId, row]));
  const substituteNames = new Map((substitutes.data ?? []).map(row => [row.id, row.display_name]));
  return {
    classrooms: visibleClasses.map(row => ({
      id: row.id, name: row.name, termId: row.term_id, grade: row.course?.grade ?? row.grade,
      courseTitle: row.course?.title ?? "", level: row.course?.class_type ?? "",
      campus: row.default_room?.campuses?.name ?? null, room: row.default_room?.name || row.room,
      teachers: [...new Map(staff.filter(item => item.classroom_id === row.id).map(person => [person.user_id, { id: person.user_id, name: person.profile?.display_name ?? "" }])).values()],
    })),
    sessions: sessions.map(session => {
      const plan = planMap.get(session.id)?.[0];
      const fact = factMap.get(session.id);
      const preparationDeadline = session.scheduled_at ? preparationDueAt({ scheduledAt: session.scheduled_at }).toISOString() : null;
      const timing = (kind: string) => fact?.taskTiming.find(row => row.kind === kind);
      const postwork = (progress: TeachingProgress, kind: string, completedAt?: string | null) => timedTeachingProgress(progress, {
        dueAt: timing(kind)?.dueAt, completedAt: completedAt === undefined ? timing(kind)?.completedAt : completedAt, now,
      });
      const artifact = (kind: string) => {
        const review = reviewMap.get(session.id)?.find(row => row.artifact_kind === kind);
        if (reviews.error || (kind === "lesson_plan" && !review && plans.error)) return unavailable();
        return timedTeachingProgress(artifactProgress(review?.status ?? (kind === "lesson_plan" ? plan?.status : undefined)), {
          dueAt: preparationDeadline, completedAt: review?.submitted_at, now,
        });
      };
      const task = (kind: string) => !fact ? unavailable() : postwork(completionProgress(fact.tasks.find(row => row.kind === kind)?.status), kind);
      const learningCompletedAt = fact?.learningResults.length && fact.learningResults.every(row => row.completedAt)
        ? fact.learningResults.map(row => row.completedAt!).sort((a, b) => Date.parse(b) - Date.parse(a))[0] : null;
      const learning = fact ? postwork(learningProgress(fact.learningResults.map(row => row.status), fact.learningResults.every(row =>
        row.status === "published" && (!row.requiresReview || Boolean(row.reviewedAt)))), "reviews", learningCompletedAt) : unavailable();
      const planReview = reviewMap.get(session.id)?.find(row => row.artifact_kind === "lesson_plan");
      let reflection = plans.error || reviews.error ? unavailable() : reflectionProgress(session.ended_at, plan);
      const submittedAfterClass = Boolean(session.ended_at && planReview && Date.parse(planReview.submitted_at) >= Date.parse(session.ended_at));
      if (reflection.state === "archived" && (!submittedAfterClass || !planReview?.reviewed_at || !plan || Date.parse(planReview.reviewed_at) < Date.parse(plan.updated_at))) {
        reflection = { state: "review", reason: "reflection_unreviewed" };
      }
      reflection = !fact && reflection.state !== "unavailable" ? unavailable() : postwork(reflection, "summary", submittedAfterClass ? planReview?.submitted_at : plan?.updated_at ?? null);
      return {
        id: session.id, classroomId: session.classroom_id, title: session.title, lectureNo: session.lecture_no,
        scheduledAt: session.scheduled_at, duration: session.duration_min, startedAt: session.started_at, endedAt: session.ended_at,
        teacherOverride: session.teacher_override ? { id: session.teacher_override, name: substituteNames.get(session.teacher_override) ?? "" } : null,
        progress: {
          solution: artifact("solution"), lesson_plan: artifact("lesson_plan"), rehearsal_video: artifact("rehearsal_video"), learning,
          class_feedback: !canReadCommunication || fact?.classFeedback === "unavailable" ? unavailable(true) : !fact ? unavailable() : postwork(classFeedbackProgress(fact.classFeedback), "summary", fact.classFeedbackCompletedAt),
          homework: task("assignment"),
          communication: !canReadCommunication || fact?.communication === "unavailable" ? unavailable(true) : !fact ? unavailable() : postwork(completionProgress(fact.communication), "followup", fact.communicationCompletedAt),
          reflection,
        },
      };
    }),
  };
}
