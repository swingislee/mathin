import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  annotationContentSchema,
  createLessonPlanTemplateV1,
  LESSON_PLAN_TEMPLATE_VERSION,
} from "../src/features/school/teacher-preparation-contract";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260730010500_doc26_teacher_workflow.sql");

describe("doc 26 teacher preparation workflow", () => {
  it("keeps the teaching plan template stable and complete", () => {
    const template = createLessonPlanTemplateV1();
    expect(LESSON_PLAN_TEMPLATE_VERSION).toBe("mathin-teaching-plan-v1");
    expect(template).toHaveLength(40);
    expect(JSON.stringify(template)).toContain("一、课前判断：学情三问");
    expect(JSON.stringify(template)).toContain("二、课程设计");
    expect(JSON.stringify(template)).toContain("三、作业设计");
    expect(JSON.stringify(template)).toContain("四、课后反思");
  });

  it("validates normalized vector strokes before persistence", () => {
    const stroke = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      mode: "ink",
      color: "ink",
      wNorm: 0.004,
      points: [[0.1, 0.2], [0.8, 0.9]],
    };
    expect(annotationContentSchema.safeParse([stroke]).success).toBe(true);
    expect(annotationContentSchema.safeParse([{ ...stroke, points: [[-0.1, 1.2]] }]).success).toBe(false);
    expect(annotationContentSchema.safeParse([{ ...stroke, color: "#000" }]).success).toBe(false);
  });

  it("persists four protected objects and exposes mutations only through guarded RPCs", () => {
    for (const table of ["lesson_plans", "lesson_page_notes", "courseware_annotations", "solution_records"]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on table public.${table} from anon, authenticated`);
    }
    expect(migration).toContain("check (template_version = 'mathin-teaching-plan-v1')");
    expect(migration).toContain("solution_source in ('upload', 'board')");
    expect(migration).toContain("Existing uploaded solutions remain valid on the first deploy");
    expect(migration).toContain("if solution_changed or not exists");
    expect(migration).toContain("create or replace function public.save_courseware_annotation");
    expect(migration).toContain("create or replace function public.generate_solution_record_from_board");
    expect(migration).toContain("create or replace function public.save_session_lesson_plan");
    expect(migration).toContain("create or replace function public.submit_session_lesson_plan");
    expect(migration).toContain("create or replace function public.save_lesson_page_note");
  });

  it("switches the left preparation flow while keeping courseware preview resident on the right", () => {
    const prep = read("src/features/school/SessionPrepPanel.tsx");
    const flow = read("src/features/school/SessionPreparationFlow.tsx");
    const lessonEditor = read("src/features/school/SessionLessonPlanEditor.tsx");
    const board = read("src/features/school/CoursewareAnnotationBoard.tsx");
    expect(prep).toContain("CoursewareOverlayEditor");
    expect(prep).toContain("lessonPlanEditor");
    expect(prep).not.toContain("SessionPreparationWorkMode");
    expect(flow).toContain("data-prep-flow-switcher");
    expect(flow).toContain('value="study"');
    expect(flow).toContain('value="design"');
    expect(flow).toContain('value="rehearsal"');
    expect(flow).toContain("lessonPlanMounted");
    expect(lessonEditor).toContain("useCreateBlockNote");
    expect(lessonEditor).toContain("saveLessonPageNoteAction");
    expect(lessonEditor).toContain("LessonPageNotesPanel");
    expect(lessonEditor).not.toContain("CoursewarePreviewWorkspace");
    expect(board).toContain("CanvasSurface");
    expect(board).toContain("generateSolutionRecordFromBoardAction");
  });

  it("reuses the existing preparation review and completion gates", () => {
    const reviewPage = read("src/app/[locale]/dashboard/courseware/preparation-review/page.tsx");
    expect(migration).toContain("session_preparation_reviews");
    expect(migration).toContain("sync_lesson_plan_review_status");
    expect(migration).toContain("assert_session_preparation_complete");
    expect(reviewPage).toContain("SessionLessonPlanReview");
    expect(reviewPage).toContain("VectorStrokePreview");
  });
});
