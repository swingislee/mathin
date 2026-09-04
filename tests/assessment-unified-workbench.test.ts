import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("unified 1:1 assessment workbench", () => {
  it("keeps teacher entry and support handoff on one continuous student row", () => {
    const workbench = source("src/features/school/AssessmentUnifiedWorkbench.tsx");

    expect(workbench).toContain("<DashboardCommandPanel>");
    expect(workbench).toContain("<DashboardTableShell data-assessment-unified-workbench>");
    expect(workbench).toContain('className="sticky left-0');
    expect(workbench).toContain("TeacherAssessmentEntryButton");
    expect(workbench).toContain("teacherObservation");
    expect(workbench).toContain("familyFeedback");
    expect(workbench).toContain("ACTIVITY_ROUTES.map");
    expect(workbench).toContain("queueFor(row, draft) === queue || row.id === retainedId");
    expect(workbench).toContain("LEARNING_CHECK_STATUS_STYLE[status]");
    expect(workbench).not.toContain("saveTeacherAssessmentQuestionAction");
  });

  it("uses one canonical route with an in-row temporary assessor handoff", () => {
    const route = source("src/app/[locale]/dashboard/assessments/support-preview/page.tsx");
    const canonical = source("src/app/[locale]/dashboard/assessments/page.tsx");
    const workbench = source("src/features/school/AssessmentUnifiedWorkbench.tsx");
    const action = source("src/features/school/assessment-assessor-actions.ts");
    const migration = source("supabase/migrations/20260904000400_school_ops_unified_assessment_assessor.sql");

    expect(route).toContain('redirect(`/${locale}/dashboard/assessments`)');
    expect(canonical).toContain("<AssessmentUnifiedWorkbench");
    expect(canonical).not.toContain("requestedDesk");
    expect(workbench).toContain("data-assessor-reassignment");
    expect(workbench).toContain("reassignAssessmentAssessorAction");
    expect(action).toContain('"reassign_assessment_assessor"');
    expect(migration).toContain("create or replace function public.reassign_assessment_assessor");
    expect(migration).toContain("ASSESSMENT_ALREADY_COMPLETED");
    expect(migration).toContain("sync_completed_assessment_actual_assessor");
    expect(migration).toContain("assessment.actual_assessor.confirmed");
  });
});
