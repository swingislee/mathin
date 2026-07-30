import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  annotationContentSchema,
  createLessonPlanTemplateV1,
  LESSON_PLAN_TEMPLATE_VERSION,
  type CoursewareAnnotation,
  type LessonPageNote,
  type LessonPlanStatus,
  type SessionLessonPlan,
  type SolutionRecord,
} from "./teacher-preparation-contract";

interface LessonPlanRow {
  id: string;
  session_id: string;
  template_version: string;
  content: unknown;
  status: string;
  revision: number;
  updated_at: string;
}

function lessonPlan(row: LessonPlanRow | null, sessionId: string): SessionLessonPlan {
  return row ? {
    id: row.id,
    sessionId: row.session_id,
    templateVersion: LESSON_PLAN_TEMPLATE_VERSION,
    content: Array.isArray(row.content) ? row.content : createLessonPlanTemplateV1(),
    status: row.status as LessonPlanStatus,
    revision: row.revision,
    updatedAt: row.updated_at,
  } : {
    id: null,
    sessionId,
    templateVersion: LESSON_PLAN_TEMPLATE_VERSION,
    content: createLessonPlanTemplateV1(),
    status: "draft",
    revision: 0,
    updatedAt: null,
  };
}

function solutionRecord(row: {
  id: string;
  solution_source: string;
  page_doc_id: string | null;
  revision: number;
  content: unknown;
  updated_at: string;
}): SolutionRecord {
  return {
    id: row.id,
    source: row.solution_source as "upload" | "board",
    pageDocId: row.page_doc_id,
    revision: row.revision,
    content: row.content && typeof row.content === "object" && !Array.isArray(row.content)
      ? row.content as Record<string, unknown>
      : {},
    updatedAt: row.updated_at,
  };
}

export interface TeacherPreparationWorkspaceData {
  lessonPlan: SessionLessonPlan;
  pageNotes: LessonPageNote[];
  annotations: CoursewareAnnotation[];
  solutionRecords: SolutionRecord[];
}

export async function getTeacherPreparationWorkspace(sessionId: string): Promise<TeacherPreparationWorkspaceData> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");

  const { data: planRow, error: planError } = await supabase
    .from("lesson_plans")
    .select("id,session_id,template_version,content,status,revision,updated_at")
    .eq("session_id", sessionId)
    .maybeSingle<LessonPlanRow>();
  if (planError) throw new Error(planError.message);

  const [{ data: noteRows, error: noteError }, { data: annotationRows, error: annotationError }, { data: solutionRows, error: solutionError }] = await Promise.all([
    planRow
      ? supabase
        .from("lesson_page_notes")
        .select("page_doc_id,content,updated_at")
        .eq("lesson_plan_id", planRow.id)
        .returns<Array<{ page_doc_id: string; content: string; updated_at: string }>>()
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("courseware_annotations")
      .select("id,page_doc_id,content,version,updated_at")
      .eq("session_id", sessionId)
      .eq("user_id", user.id)
      .eq("annotation_type", "board")
      .returns<Array<{ id: string; page_doc_id: string; content: unknown; version: number; updated_at: string }>>(),
    supabase
      .from("solution_records")
      .select("id,solution_source,page_doc_id,revision,content,updated_at")
      .eq("session_id", sessionId)
      .returns<Array<{ id: string; solution_source: string; page_doc_id: string | null; revision: number; content: unknown; updated_at: string }>>(),
  ]);
  if (noteError) throw new Error(noteError.message);
  if (annotationError) throw new Error(annotationError.message);
  if (solutionError) throw new Error(solutionError.message);

  return {
    lessonPlan: lessonPlan(planRow, sessionId),
    pageNotes: (noteRows ?? []).map((row) => ({
      pageDocId: row.page_doc_id,
      content: row.content,
      updatedAt: row.updated_at,
    })),
    annotations: (annotationRows ?? []).flatMap((row) => {
      const parsed = annotationContentSchema.safeParse(row.content);
      return parsed.success ? [{
        id: row.id,
        pageDocId: row.page_doc_id,
        content: parsed.data,
        version: row.version,
        updatedAt: row.updated_at,
      }] : [];
    }),
    solutionRecords: (solutionRows ?? []).map(solutionRecord),
  };
}

export async function getTeacherPreparationReviewData(sessionId: string): Promise<{
  lessonPlan: SessionLessonPlan | null;
  solutionRecords: SolutionRecord[];
}> {
  const supabase = await createClient();
  const [{ data: planRow, error: planError }, { data: solutionRows, error: solutionError }] = await Promise.all([
    supabase
      .from("lesson_plans")
      .select("id,session_id,template_version,content,status,revision,updated_at")
      .eq("session_id", sessionId)
      .maybeSingle<LessonPlanRow>(),
    supabase
      .from("solution_records")
      .select("id,solution_source,page_doc_id,revision,content,updated_at")
      .eq("session_id", sessionId)
      .returns<Array<{ id: string; solution_source: string; page_doc_id: string | null; revision: number; content: unknown; updated_at: string }>>(),
  ]);
  if (planError) throw new Error(planError.message);
  if (solutionError) throw new Error(solutionError.message);
  return {
    lessonPlan: planRow ? lessonPlan(planRow, sessionId) : null,
    solutionRecords: (solutionRows ?? []).map(solutionRecord),
  };
}
