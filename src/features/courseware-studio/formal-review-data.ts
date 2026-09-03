import "server-only";

import { createClient } from "@/lib/supabase/server";
import { listTeacherMicrocourseReviewQueue } from "@/features/teacher-microcourses/data";
import type { CoursewareTrack } from "./data";

export interface FormalCoursewareReviewQueueItem {
  reviewCycleId: string;
  lectureId: string;
  lectureNo: number;
  lectureName: string;
  courseTitle: string;
  familyTitle: string;
  track: CoursewareTrack;
  stage: "in_review" | "ready_to_publish";
  reviewRoundNo: number;
  requiredReviewRounds: number;
  creatorName: string;
  submissionNote: string;
  submittedAt: string;
  internalDueAt: string | null;
}

/**
 * Formal-course review is projected from the lifecycle head, not from the
 * retired 4:3 adaptation queues. Teacher-microcourse cycles share the same
 * base table, so their canonical queue ids are explicitly excluded here.
 */
export async function listFormalCoursewareReviewQueue(): Promise<FormalCoursewareReviewQueueItem[]> {
  const supabase = await createClient();
  const [{ data: workflows, error: workflowError }, microcourseItems] = await Promise.all([
    supabase
      .from("cw_lecture_workflows")
      .select("lecture_id,track,stage,current_review_round,required_review_rounds_snapshot,active_review_cycle_id,internal_due_at,updated_at")
      .in("stage", ["in_review", "ready_to_publish"])
      .not("active_review_cycle_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(200),
    listTeacherMicrocourseReviewQueue(),
  ]);
  if (workflowError) throw new Error(workflowError.message);

  const microcourseCycleIds = new Set(microcourseItems.map((item) => item.reviewCycleId));
  const formalWorkflows = (workflows ?? []).filter((row) => (
    row.active_review_cycle_id && !microcourseCycleIds.has(row.active_review_cycle_id)
  ));
  const cycleIds = formalWorkflows.flatMap((row) => row.active_review_cycle_id ? [row.active_review_cycle_id] : []);
  if (cycleIds.length === 0) return [];

  const { data: cycles, error: cycleError } = await supabase
    .from("cw_review_cycles")
    .select("id,lecture_id,status,creator_id,review_round_no,submission_note,submitted_at")
    .in("id", cycleIds);
  if (cycleError) throw new Error(cycleError.message);
  const formalCycles = (cycles ?? []).filter((row) => row.status === "submitted" || row.status === "passed");
  const lectureIds = [...new Set(formalCycles.map((row) => row.lecture_id))];
  const creatorIds = [...new Set(formalCycles.map((row) => row.creator_id))];
  if (lectureIds.length === 0) return [];

  const [{ data: lectures, error: lectureError }, { data: creators, error: creatorError }] = await Promise.all([
    supabase.from("course_lectures").select("id,course_id,no,name").in("id", lectureIds),
    supabase.from("profiles").select("id,display_name").in("id", creatorIds),
  ]);
  if (lectureError) throw new Error(lectureError.message);
  if (creatorError) throw new Error(creatorError.message);

  const courseIds = [...new Set((lectures ?? []).map((row) => row.course_id))];
  const { data: courses, error: courseError } = await supabase
    .from("courses")
    .select("id,family_id,title")
    .in("id", courseIds);
  if (courseError) throw new Error(courseError.message);
  const familyIds = [...new Set((courses ?? []).map((row) => row.family_id))];
  const { data: families, error: familyError } = await supabase
    .from("course_families")
    .select("id,title")
    .in("id", familyIds);
  if (familyError) throw new Error(familyError.message);

  const workflowByCycleId = new Map(formalWorkflows.map((row) => [row.active_review_cycle_id, row]));
  const lectureById = new Map((lectures ?? []).map((row) => [row.id, row]));
  const courseById = new Map((courses ?? []).map((row) => [row.id, row]));
  const familyById = new Map((families ?? []).map((row) => [row.id, row]));
  const creatorById = new Map((creators ?? []).map((row) => [row.id, row.display_name]));

  return formalCycles.flatMap((cycle) => {
    const workflow = workflowByCycleId.get(cycle.id);
    const lecture = lectureById.get(cycle.lecture_id);
    const course = lecture ? courseById.get(lecture.course_id) : null;
    const family = course ? familyById.get(course.family_id) : null;
    if (!workflow || !lecture || !course || !family) return [];
    if (workflow.track !== "native-16x9" && workflow.track !== "adapted-4x3") return [];
    if (workflow.stage !== "in_review" && workflow.stage !== "ready_to_publish") return [];
    return [{
      reviewCycleId: cycle.id,
      lectureId: lecture.id,
      lectureNo: lecture.no,
      lectureName: lecture.name,
      courseTitle: course.title,
      familyTitle: family.title,
      track: workflow.track,
      stage: workflow.stage,
      reviewRoundNo: cycle.review_round_no,
      requiredReviewRounds: workflow.required_review_rounds_snapshot ?? cycle.review_round_no,
      creatorName: creatorById.get(cycle.creator_id) ?? "—",
      submissionNote: cycle.submission_note,
      submittedAt: cycle.submitted_at,
      internalDueAt: workflow.internal_due_at,
    } satisfies FormalCoursewareReviewQueueItem];
  }).sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
}
