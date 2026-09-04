import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  quickScoreForOutcome,
  teacherAssessmentSummary,
  type TeacherAssessmentPaperVersion,
  type TeacherAssessmentQuestion,
} from "@/features/school/teacher-assessment-contract";

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
      independent: maxScore,
      prompted: Math.round(maxScore * 0.7),
      partial: Math.round(maxScore * 0.4),
      unable: 0,
      not_tested: null,
    },
    result: score === null ? null : {
      outcome: "independent",
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
    expect(quickScoreForOutcome(questions[2], "independent")).toBe(8);
    expect(quickScoreForOutcome(questions[2], "not_tested")).toBeNull();
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

  it("uses a dense tablet/desktop table and a separate mobile entry layout", () => {
    const workbench = read("src", "features", "school", "TeacherAssessmentWorkbench.tsx");
    const page = read("src", "app", "[locale]", "dashboard", "assessments", "[registrationId]", "page.tsx");
    const aggregate = read("src", "features", "school", "AssessmentAggregateWorkbench.tsx");
    const routes = read("src", "features", "school", "dashboard-routes.ts");

    expect(workbench).toContain('className="hidden min-h-0 flex-1 md:block"');
    expect(workbench).toContain("md:hidden");
    expect(workbench).toContain('"h-7 cursor-default"');
    expect(workbench).toContain("OUTCOME_SHORTCUTS");
    expect(workbench).toContain("notePlaceholder");
    expect(workbench).not.toContain("questionCount: 19");
    expect(workbench).not.toContain("totalScore: 150");
    expect(page).toContain("getTeacherAssessmentWorkbenchData");
    expect(aggregate).toContain("TeacherAssessmentEntryButton");
    expect(routes).toContain('hrefPattern: "/dashboard/assessments/[registrationId]"');
    expect(routes).toContain('shellMode: "panel"');
  });
});
