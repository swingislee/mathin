import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("support assessment handoff preview", () => {
  it("keeps teacher evidence read-only and gives support one continuous family handoff row", () => {
    const preview = source("src/features/school/SupportAssessmentPreview.tsx");

    expect(preview).toContain("<DashboardCommandPanel>");
    expect(preview).toContain("<DashboardTableShell data-support-assessment-workbench>");
    expect(preview).toContain('className="sticky left-0');
    expect(preview).toContain("teacherObservation");
    expect(preview).toContain("familyFeedback");
    expect(preview).toContain("ACTIVITY_ROUTES.map");
    expect(preview).toContain('queueFor(row) === queue || row.id === retainedId');
    expect(preview).toContain("LEARNING_CHECK_STATUS_STYLE[status]");
    expect(preview).not.toContain("saveTeacherAssessmentQuestionAction");
    expect(preview).not.toContain("TeacherAssessmentWorkbench");
  });

  it("exposes the acceptance page only to a signed-in local staff environment", () => {
    const route = source("src/app/[locale]/dashboard/assessments/support-preview/page.tsx");

    expect(route).toContain('process.env.NODE_ENV === "production"');
    expect(route).toContain('requireDashboardEnvironment(locale, ["staff"])');
    expect(route).toContain("<SupportAssessmentPreview locale={locale}");
  });
});
