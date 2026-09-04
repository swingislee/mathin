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
const reviewFollowupMigration = read("supabase/migrations/20260731000200_doc26_review_courseware_and_withdrawal.sql");
const boardItemsMigration = read("supabase/migrations/20260731000700_doc26_annotation_board_items.sql");
const blueColorMigration = read("supabase/migrations/20260823000300_whiteboard_blue_color.sql");
const operationalGateMigration = read("supabase/migrations/20260822000200_r1_live_operational_gate_simplification.sql");

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

  it("validates normalized whiteboard items before persistence", () => {
    const stroke = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      mode: "ink",
      color: "ink",
      wNorm: 0.004,
      points: [[0.1, 0.2], [0.8, 0.9]],
    };
    expect(annotationContentSchema.safeParse([stroke]).success).toBe(true);
    expect(annotationContentSchema.safeParse([{ ...stroke, color: "blue" }]).success).toBe(true);
    expect(annotationContentSchema.safeParse([{ ...stroke, points: [[-0.1, 1.2]] }]).success).toBe(false);
    expect(annotationContentSchema.safeParse([{ ...stroke, color: "#000" }]).success).toBe(false);
    const shape = {
      id: "550e8400-e29b-41d4-a716-446655440001",
      kind: "shape",
      shape: "rectangle",
      color: "rose",
      fill: "moon",
      strokeWidthNorm: 0.004,
      x: 0.5,
      y: 0.5,
      width: 0.3,
      height: 0.2,
      rotation: 0,
    };
    expect(annotationContentSchema.safeParse([stroke, shape]).success).toBe(true);
    expect(blueColorMigration.match(/'blue'/g)?.length).toBeGreaterThanOrEqual(3);
    expect(blueColorMigration).toContain("validate_courseware_annotation_content");
    expect(annotationContentSchema.safeParse([{ ...shape, width: 2 }]).success).toBe(false);
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
    const solutionArchive = read("src/features/school/SessionSolutionArchive.tsx");
    const solutionExport = read("src/features/school/solution-record-export.ts");
    const overlayEditor = read("src/features/school/CoursewareOverlayEditor.tsx");
    const overlayContract = read("src/features/school/courseware-overlay.ts");
    const styles = read("src/features/school/session-lesson-plan-editor.css");
    expect(prep).toContain("CoursewareOverlayEditor");
    expect(prep).toContain("lessonPlanEditor");
    expect(prep).not.toContain("SessionPreparationWorkMode");
    expect(flow).toContain("data-prep-flow-switcher");
    expect(flow).toContain('value="study"');
    expect(flow).toContain('value="design"');
    expect(flow).toContain('value="rehearsal"');
    expect(flow).toContain("lessonPlanMounted");
    expect(flow).toContain("data-prep-stage-complete");
    expect(flow).toContain("data-preparation-reviewer-selector");
    expect(flow).toContain("grid-cols-[minmax(0,1fr)_7.75rem]");
    expect(flow).toContain("data-prep-stage-status-icon");
    expect(flow).toContain("setSessionPreparationReviewerAction");
    expect(flow).toContain("prepReviewerPhaseOneHint");
    expect(flow).toContain("SessionSolutionArchive");
    expect(prep).not.toContain("data-prep-workflow-heading");
    expect(lessonEditor).toContain("useCreateBlockNote");
    expect(lessonEditor).toContain('t("lessonPlanSubmitShort")');
    expect(lessonEditor).toContain("withdrawSessionLessonPlanAction");
    expect(lessonEditor).toContain('t("lessonPlanWithdrawReview")');
    expect(lessonEditor).not.toContain("saveLessonPageNoteAction");
    expect(lessonEditor).not.toContain("LessonPageNotesPanel");
    expect(lessonEditor).not.toContain("CoursewarePreviewWorkspace");
    expect(solutionArchive).toContain("data-solution-record-archive");
    expect(solutionArchive).toContain("SolutionRecordExportButton");
    expect(solutionArchive).toContain("exportSolutionRecordWebp");
    expect(solutionArchive).toContain("pagePreviews.find");
    expect(board).toContain("SolutionRecordPreview");
    expect(board).toContain("StagePreview");
    expect(board).toContain("data-solution-record-preview");
    expect(solutionExport).toContain("canvasWidth: EXPORT_WIDTH");
    expect(solutionExport).toContain("canvasHeight: EXPORT_HEIGHT");
    expect(solutionExport).toContain('"image/webp"');
    expect(overlayEditor).toContain("data-courseware-save-state");
    expect(overlayEditor).toContain("structureReadOnly || templatePage");
    expect(overlayContract).toContain("templateIdSet.has(slot.page.id)");
    expect(board).toContain("CanvasSurface");
    expect(board).toContain("Toolbar");
    expect(board).toContain("data-courseware-annotation-toolbar");
    expect(board).toContain("content: state.items");
    expect(board).not.toContain("function ToolButton");
    expect(board).toContain("generateSolutionRecordFromBoardAction");
    expect(boardItemsMigration).toContain("item_kind = 'shape'");
    expect(boardItemsMigration).toContain("'items', annotation_row.content");
    expect(styles).toContain('.lesson-plan-editor.bn-root .bn-side-menu[data-block-type="heading"][data-level="1"]');
    expect(styles).toContain('.lesson-plan-editor.bn-root .bn-side-menu[data-block-type="heading"][data-level="2"]');
    expect(styles).toContain('.lesson-plan-editor.bn-root .bn-side-menu[data-block-type="heading"][data-level="3"]');
    expect(styles).toContain("height: 40px !important");
    expect(styles).toContain("height: 36px !important");
    expect(styles).toContain("height: 34px !important");
  });

  it("reuses preparation review surfaces while making completion advisory", () => {
    const reviewCourseware = read("src/features/school/SessionPreparationCoursewareReview.tsx");
    const sessionPage = read("src/app/[locale]/dashboard/sessions/[sessionId]/page.tsx");
    const prepPanel = read("src/features/school/SessionPrepPanel.tsx");
    const prepFlow = read("src/features/school/SessionPreparationFlow.tsx");
    const workItems = read("src/features/school/work-items.ts");
    const overlayEditor = read("src/features/school/CoursewareOverlayEditor.tsx");
    expect(migration).toContain("session_preparation_reviews");
    const reviewerMigration = read("supabase/migrations/20260731000100_doc26_preparation_reviewer_selection.sql");
    expect(reviewerMigration).toContain("reviewer_assignment_source");
    expect(reviewerMigration).toContain("teacher_selected");
    expect(reviewerMigration).toContain("supervisor_assigned");
    expect(reviewerMigration).toContain("list_session_preparation_reviewer_candidates");
    expect(reviewerMigration).toContain("set_session_preparation_reviewer");
    expect(reviewerMigration).toContain("preparation.reviewer_id = p_user_id");
    expect(migration).toContain("sync_lesson_plan_review_status");
    expect(migration).toContain("assert_session_preparation_complete");
    expect(operationalGateMigration).toContain("create or replace function public.assert_session_preparation_complete");
    expect(operationalGateMigration).not.toContain("solution_records");
    expect(operationalGateMigration).not.toContain("lesson_plans");
    expect(operationalGateMigration).not.toContain("session_preparation_reviews");
    expect(operationalGateMigration).not.toContain("session_learning_checks");
    expect(prepPanel).toContain("canReview={prepArtifacts.reviewerId === detail.viewerId}");
    expect(prepFlow).toContain("PreparationReviewActions");
    expect(workItems).toContain('case "session"');
    expect(reviewCourseware).toContain("CoursewareWorkbench");
    expect(reviewCourseware).toContain('mode="preview"');
    expect(reviewCourseware).toContain("StagePreview");
    expect(reviewCourseware).toContain("prepReviewEditCurrentPage");
    expect(reviewFollowupMigration).toContain("get_session_preparation_review_courseware");
    expect(reviewFollowupMigration).toContain("get_session_preparation_review_page_docs");
    expect(reviewFollowupMigration).toContain("list_session_preparation_review_resolved_assets");
    expect(reviewFollowupMigration).toContain("withdraw_session_lesson_plan");
    expect(reviewFollowupMigration).toContain("review_row.submitted_by <> uid");
    expect(reviewFollowupMigration).toContain("review_row.status <> 'pending'");
    expect(reviewFollowupMigration).toContain("update public.lesson_plans plan");
    expect(sessionPage).toContain("prepStep");
    expect(sessionPage).toContain("prepPage");
    expect(overlayEditor).toContain("initialPageId");
    expect(overlayEditor).toContain("resolveCourseware(template, initialOverlay)");
    expect(fs.existsSync(path.join(root, "src/app/[locale]/dashboard/courseware/preparation-review/page.tsx"))).toBe(false);
    expect(read("src/features/school/nav.ts")).not.toContain('"coursewarePreparationReview"');
  });
});
