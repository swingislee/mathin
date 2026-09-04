import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  quickScoreForOutcome,
  teacherAssessmentSummary,
  type TeacherAssessmentPaperVersion,
  type TeacherAssessmentQuestion,
} from "@/features/school/teacher-assessment-contract";
import { LEARNING_CHECK_STATUS_STYLE } from "@/features/school/session-learning-visual";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

const paper: TeacherAssessmentPaperVersion = {
  id: "93000000-0000-4000-8000-000000000101",
  paperId: "93000000-0000-4000-8000-000000000001",
  title: "Variable paper",
  source: "aixuexi",
  versionNo: 1,
  questionCount: 3,
  totalScore: 21,
  bandThresholds: { x_plus: 0, g_plus: 40, a: 55, a_plus: 70, s: 85, c: 95 },
};

function question(
  position: number,
  maxScore: number,
  score: number | null,
): TeacherAssessmentQuestion {
  return {
    id: `93000000-0000-4001-8000-${String(position).padStart(12, "0")}`,
    position,
    questionNo: String(position),
    prompt: `Question ${position}`,
    knowledgePoint: "Number sense",
    maxScore,
    quickScores: {
      explained: maxScore,
      independent: maxScore,
      prompted: Math.round(maxScore * 0.7),
      imitated: Math.round(maxScore * 0.4),
      incomplete: 0,
    },
    result: score === null ? null : {
      outcome: "explained",
      score,
      note: "",
      updatedAt: "2026-09-04T00:00:00.000Z",
    },
  };
}

describe("teacher question assessment workbench", () => {
  it("derives progress, score and band from backend paper values instead of a 100-point constant", () => {
    const questions = [question(1, 6, 6), question(2, 7, 5), question(3, 8, null)];
    const summary = teacherAssessmentSummary(paper, questions);

    expect(summary).toEqual({
      answeredCount: 2,
      questionCount: 3,
      score: 11,
      totalScore: 21,
      suggestedBand: "g_plus",
      completedAt: undefined,
    });
    expect(quickScoreForOutcome(questions[2], "explained")).toBe(8);
    expect(quickScoreForOutcome(questions[2], "incomplete")).toBe(0);
  });

  it("persists an immutable paper version and one result per registration question", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260904000230_teacher_assessment_question_workbench.sql",
    );

    expect(migration).toContain("create table public.assessment_papers");
    expect(migration).toContain("create table public.assessment_paper_versions");
    expect(migration).toContain("create table public.assessment_paper_questions");
    expect(migration).toContain("create table public.assessment_question_results");
    expect(migration).toContain("assessment_paper_version_id uuid");
    expect(migration).toContain("ASSESSMENT_PAPER_VERSION_LOCKED");
    expect(migration).toContain("save_teacher_assessment_question");
    expect(migration).toContain("complete_teacher_assessment");
    expect(migration).toContain("get_teacher_assessment_workbench");
    expect(migration).toContain("score between 0 and 10000");
  });

  it("fills only unanswered questions through one atomic RPC and supports one-step undo", () => {
    const actions = read("src", "features", "school", "teacher-assessment-actions.ts");
    const migration = read(
      "supabase",
      "migrations",
      "20260904000260_teacher_assessment_bulk_fill.sql",
    );

    expect(actions).toContain('"fill_teacher_assessment_questions"');
    expect(actions).toContain('"undo_teacher_assessment_question_fill"');
    expect(actions).toContain("z.array(uuid).min(1).max(200)");
    expect(migration).toContain("create or replace function public.fill_teacher_assessment_questions");
    expect(migration).toContain("create or replace function public.undo_teacher_assessment_question_fill");
    expect(migration).toContain("if v_existing_outcome is null then");
    expect(migration).toContain("result.outcome = p_outcome");
  });

  it("keeps the classroom learning-check ratings with explained as the highest level", () => {
    const contract = read("src", "features", "school", "teacher-assessment-contract.ts");
    const statusMigration = read(
      "supabase",
      "migrations",
      "20260904000250_teacher_assessment_learning_check_statuses.sql",
    );

    expect(contract).toContain("LEARNING_CHECK_RATED_STATUSES");
    expect(statusMigration).toContain("'explained', 'independent', 'prompted', 'imitated', 'incomplete'");
    expect(statusMigration).toContain("when 'partial' then 'imitated'");
    expect(statusMigration).toContain("when 'unable' then 'incomplete'");
    expect(statusMigration).toContain("when 'not_tested' then 'incomplete'");
  });

  it("uses one semantic palette across entry and result surfaces", () => {
    const postwork = read("src", "features", "school", "SessionStudentPostworkCards.tsx");
    const studentResults = read("src", "features", "school", "StudentLearningCheckResults.tsx");

    expect(LEARNING_CHECK_STATUS_STYLE.explained.active).toContain("sky");
    expect(LEARNING_CHECK_STATUS_STYLE.independent.active).toContain("leaf");
    expect(LEARNING_CHECK_STATUS_STYLE.prompted.active).toContain("yellow");
    expect(LEARNING_CHECK_STATUS_STYLE.imitated.active).toContain("orange");
    expect(LEARNING_CHECK_STATUS_STYLE.incomplete.active).toContain("rose");
    expect(LEARNING_CHECK_STATUS_STYLE.imitated.active).not.toContain("violet");
    expect(postwork).toContain("LEARNING_CHECK_STATUS_STYLE[check.status]");
    expect(studentResults).toContain("LEARNING_CHECK_STATUS_STYLE[record.status]");
  });

  it("uses the same students × questions matrix as classroom entry instead of maintaining a second renderer", () => {
    const workbench = read("src", "features", "school", "TeacherAssessmentWorkbench.tsx");
    const classroomPanel = read("src", "features", "school", "SessionLearningCheckPanel.tsx");
    const matrix = read("src", "features", "school", "LearningCheckMatrixEntry.tsx");
    const quickEntryGrid = read("src", "features", "school", "LearningCheckQuickEntryGrid.tsx");
    const page = read("src", "app", "[locale]", "dashboard", "assessments", "[registrationId]", "page.tsx");
    const aggregate = read("src", "features", "school", "AssessmentAggregateWorkbench.tsx");
    const routes = read("src", "features", "school", "dashboard-routes.ts");

    expect(workbench).toContain("<LearningCheckMatrixEntry");
    expect(classroomPanel).toContain("<LearningCheckMatrixEntry");
    expect(workbench).not.toContain("<LearningCheckQuickEntryGrid");
    expect(classroomPanel).not.toContain("<LearningCheckQuickEntryGrid");
    expect(matrix).toContain("<LearningCheckQuickEntryGrid");
    expect(matrix).toContain("<LearningCheckQuickEntryCard");
    expect(matrix).toContain("<LearningFillRail");
    expect(matrix).toContain('"by-question" | "by-student"');
    expect(matrix).toContain("data-learning-matrix-orientation={orientation}");
    expect(matrix).toContain("fill.onFill(uncheckedCells, status)");
    expect(quickEntryGrid).toContain("LEARNING_SEAT_CAPACITY");
    expect(quickEntryGrid).toContain("LEARNING_SEAT_COLUMNS");
    expect(quickEntryGrid).toContain("grid-cols-3 auto-rows-[2.75rem]");
    expect(workbench).toContain("data-teacher-assessment-active-editor");
    expect(workbench).toContain("data-teacher-assessment-entry-surface");
    expect(matrix).toContain("sm:hidden");
    expect(matrix).toContain("STATUS_SHORTCUTS");
    expect(workbench).toContain("notePlaceholder");
    expect(workbench).not.toContain("questionCount: 19");
    expect(workbench).not.toContain("totalScore: 150");
    expect(page).toContain("getTeacherAssessmentWorkbenchData");
    expect(aggregate).toContain("TeacherAssessmentEntryButton");
    expect(routes).toContain('hrefPattern: "/dashboard/assessments/[registrationId]"');
    expect(routes).toContain('shellMode: "panel"');
  });
});
