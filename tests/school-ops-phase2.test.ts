import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("DEV-SCHOOL-OPS-1 Phase 2 node worktables", () => {
  it("keeps spreadsheet entry while storing assessment and routing as separate facts", () => {
    const migration = read("supabase", "migrations", "20260902000400_school_ops_phase2_node_worktables.sql");

    expect(migration).toContain("alter table public.assessment_results");
    expect(migration).toContain("add column parent_concerns");
    expect(migration).toContain("add column recommended_class");
    expect(migration).toContain("create table public.activity_routes");
    expect(migration).toContain("alter table public.activity_routes enable row level security");
    expect(migration).toContain("save_activity_assessment_row");
    expect(migration).toContain("save_activity_route");
  });

  it("marks participation attended when assessment entry begins without mutating a global student stage", () => {
    const migration = read("supabase", "migrations", "20260902000400_school_ops_phase2_node_worktables.sql");
    const actions = read("src", "features", "school", "activity-actions.ts");
    const workspace = read("src", "features", "school", "ActivityWorkspace.tsx");

    expect(migration).toContain("begin_activity_assessment");
    expect(migration).toContain("status = 'attended'");
    expect(migration).not.toContain("set follow_up_status");
    expect(actions).toContain("beginActivityAssessmentAction");
    expect(workspace).toContain("markAttendedWhenEditing");
    expect(workspace).toContain("autoAttendedIds");
  });

  it("selects a business node before presenting its table fields", () => {
    const page = read("src", "app", "[locale]", "dashboard", "activities", "[activityId]", "page.tsx");
    const workspace = read("src", "features", "school", "ActivityWorkspace.tsx");
    const routes = read("src", "features", "school", "dashboard-routes.ts");

    expect(page).toContain("ACTIVITY_WORKSPACE_NODES");
    expect(workspace).toContain("DashboardCommandTabs");
    expect(workspace).toContain("ParticipationTable");
    expect(workspace).toContain("AssessmentTable");
    expect(workspace).toContain("RoutingTable");
    expect(workspace).toContain("useAutosavedDraft");
    expect(workspace).not.toContain("OpportunityEditor");
    expect(workspace).not.toContain("salesOpportunity");
    expect(routes).toContain('hrefPattern: "/dashboard/activities/[activityId]"');
    expect(routes).not.toContain('href: "/dashboard/opportunities"');
  });

  it("keeps the node tables and routing language bilingual", () => {
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");
    for (const key of [
      "entryNode",
      "nodeParticipation",
      "nodeAssessment",
      "nodeRouting",
      "parentConcerns",
      "route_continue_follow_up",
      "route_await_product",
    ]) {
      expect(zh).toContain(`\"${key}\"`);
      expect(en).toContain(`\"${key}\"`);
    }
  });
});
