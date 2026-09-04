import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("school operations Phase 6 management analytics slice", () => {
  it("ships a report-gated route and a discoverable staff navigation contract", () => {
    const page = read("src", "app", "[locale]", "dashboard", "management-analytics", "page.tsx");
    const routes = read("src", "features", "school", "dashboard-routes.ts");
    const nav = read("src", "features", "school", "nav.ts");
    const shell = read("src", "features", "school", "DashboardShell.tsx");

    expect(page).toContain('requirePerm(locale, "report.view.all")');
    expect(page).toContain("getMyPerms(user.id)");
    expect(page).toContain("resolveManagementAnalyticsSourceAccess");
    expect(page).toContain("normalizeManagementAnalyticsGrain");
    expect(routes).toContain('href: "/dashboard/management-analytics"');
    expect(routes).toContain('permission: "report.view.all"');
    expect(nav).toContain('"managementAnalytics"');
    expect(shell).toContain("managementAnalytics: ChartSpline");
  });

  it("reads the available funnel and attendance facts without inventing aggregate numbers", () => {
    const data = read("src", "features", "school", "management-analytics.ts");
    for (const table of [
      "lead_source_records",
      "leads",
      "lead_communications",
      "lead_invitation_threads",
      "lead_invitation_events",
      "activities",
      "activity_registrations",
      "assessment_results",
      "lead_next_actions",
      "class_sessions",
      "enrollments",
      "session_attendance",
    ]) {
      expect(data).toContain(`.from("${table}")`);
    }
    expect(data).toContain("owner_id_at_contact");
    expect(data).toContain("owner_id_at_open");
    expect(data).toContain("firstSourceByLead");
    expect(data).toContain("membership_valid_when_session_scheduled");
  });

  it("keeps commercial enrollment, product, and renewal metrics explicit dependencies", () => {
    const data = read("src", "features", "school", "management-analytics.ts");
    const view = read("src", "features", "school", "ManagementAnalyticsDashboard.tsx");

    expect(data).toContain('{ key: "commercialEnrollment", phase: 3 }');
    expect(data).toContain('{ key: "product", phase: 3 }');
    expect(data).toContain('{ key: "renewal", phase: 5 }');
    expect(view).toContain("waitingForFacts");
    expect(view).toContain("getManagementAnalyticsData");
  });

  it("provides matching Chinese and English acceptance copy", () => {
    const zh = JSON.parse(read("messages", "zh.json"));
    const en = JSON.parse(read("messages", "en.json"));

    expect(zh.school.nav.managementAnalytics).toBeTruthy();
    expect(en.school.nav.managementAnalytics).toBeTruthy();
    expect(Object.keys(zh.school.managementAnalytics).sort()).toEqual(
      Object.keys(en.school.managementAnalytics).sort(),
    );
    expect(zh.school.managementAnalytics.description).toContain("Opportunity→Enrollment");
    expect(en.school.managementAnalytics.description).toContain("Opportunity→Enrollment");
  });
});
