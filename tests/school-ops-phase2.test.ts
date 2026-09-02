import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("DEV-SCHOOL-OPS-1 Phase 2", () => {
  it("keeps assessment and opportunity as first-class RLS facts", () => {
    const migration = read("supabase", "migrations", "20260902000200_school_ops_phase2_activity_funnel.sql");

    expect(migration).toContain("create table public.assessment_results");
    expect(migration).toContain("create table public.sales_opportunities");
    expect(migration).toContain("alter table public.assessment_results enable row level security");
    expect(migration).toContain("alter table public.sales_opportunities enable row level security");
    expect(migration).toContain("PARTICIPATION_NOT_ATTENDED");
    expect(migration).toContain("ASSESSMENT_REQUIRED");
    expect(migration).toContain("student_id, author_id, content, kind, next_follow_up_at");
  });

  it("delivers an activity object workspace instead of a planning surface", () => {
    const page = read("src", "app", "[locale]", "dashboard", "activities", "[activityId]", "page.tsx");
    const opportunityPage = read("src", "app", "[locale]", "dashboard", "opportunities", "page.tsx");
    const workspace = read("src", "features", "school", "ActivityWorkspace.tsx");
    const routes = read("src", "features", "school", "dashboard-routes.ts");

    expect(page).toContain("ObjectWorkspace");
    expect(page).toContain("ActivityWorkspace");
    expect(workspace).toContain("ParticipationRoster");
    expect(workspace).toContain("AssessmentEditor");
    expect(workspace).toContain("OpportunityEditor");
    expect(workspace).toContain("DashboardTableShell");
    expect(workspace).not.toContain("school-ops");
    expect(opportunityPage).toContain("listSalesOpportunities");
    expect(opportunityPage).toContain("teacherRecommendation");
    expect(opportunityPage.match(/<DashboardCommandState/g)).toHaveLength(1);
    expect(opportunityPage).toContain('t("opportunityScopeLabel")');
    expect(opportunityPage).toContain('t("opportunityStageFilter")');
    expect(opportunityPage).not.toContain("source_registration_id");
    expect(routes).toContain('hrefPattern: "/dashboard/activities/[activityId]"');
    expect(routes).toContain('href: "/dashboard/opportunities"');
  });

  it("keeps the Phase 2 forms and states bilingual", () => {
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");
    for (const key of [
      "participationRoster",
      "assessmentResult",
      "teacherRecommendation",
      "salesOpportunity",
      "nextAction",
      "stage_won",
      "stage_lost",
    ]) {
      expect(zh).toContain(`\"${key}\"`);
      expect(en).toContain(`\"${key}\"`);
    }
  });
});
