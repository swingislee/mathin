import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("DEV-SCHOOL-OPS-1 Phase 2 assessment-session worktable", () => {
  it("keeps one-row session entry while storing assessment and routing as separate facts", () => {
    const baseMigration = read("supabase", "migrations", "20260902000400_school_ops_phase2_node_worktables.sql");
    const sessionMigration = read("supabase", "migrations", "20260902000600_school_ops_phase2_assessment_session_entry.sql");

    expect(baseMigration).toContain("alter table public.assessment_results");
    expect(baseMigration).toContain("create table public.activity_routes");
    expect(sessionMigration).toContain("activity_routes_route_check");
    expect(sessionMigration).toContain("'enrollment_pending'");
    expect(sessionMigration).toContain("save_activity_assessment_row");
    expect(sessionMigration).toContain("save_activity_route");
  });

  it("marks participation attended from review entry and does not grant assessment writing to roster managers", () => {
    const migration = read("supabase", "migrations", "20260902000600_school_ops_phase2_assessment_session_entry.sql");
    const actions = read("src", "features", "school", "activity-actions.ts");
    const workspace = read("src", "features", "school", "ActivityWorkspace.tsx");

    expect(migration).toContain("begin_activity_assessment");
    expect(migration).toContain("status = 'attended'");
    expect(migration).toContain("not public.has_perm(uid, 'review.write')");
    expect(actions).toContain("beginActivityAssessmentAction");
    expect(actions).toContain('authorizedActivityClient("review.write")');
    expect(actions).not.toContain("authorizedActivityClientAny");
    expect(workspace).toContain("markAttendedWhenEditing");
    expect(workspace).toContain("autoAttendedIds");
  });

  it("uses two work-session nodes and keeps assessment plus outcome on the same student row", () => {
    const page = read("src", "app", "[locale]", "dashboard", "activities", "[activityId]", "page.tsx");
    const workspace = read("src", "features", "school", "ActivityWorkspace.tsx");
    const contract = read("src", "features", "school", "activity-workflow-contract.ts");
    const routes = read("src", "features", "school", "dashboard-routes.ts");

    expect(page).toContain("ACTIVITY_WORKSPACE_NODES");
    expect(page).toContain('canAssess && !canRegister ? "assessment" : "participation"');
    expect(page).toContain('canAssess={canAssess}');
    expect(workspace).toContain("DashboardCommandTabs");
    expect(workspace).toContain("ParticipationTable");
    expect(workspace).toContain("AssessmentTable");
    expect(workspace).not.toContain("RoutingTable");
    expect(workspace).toContain("saveActivityAssessmentAction");
    expect(workspace).toContain("saveActivityRouteAction");
    expect(workspace).toContain("sticky left-0");
    expect(workspace).toContain("useAutosavedDraft");
    expect(workspace).not.toContain("OpportunityEditor");
    expect(workspace).not.toContain("salesOpportunity");
    expect(contract).toContain('"participation"');
    expect(contract).toContain('"assessment"');
    expect(contract).not.toContain('"routing"');
    expect(routes).toContain('hrefPattern: "/dashboard/activities/[activityId]"');
    expect(routes).not.toContain('href: "/dashboard/opportunities"');
  });

  it("keeps the session-entry and enrollment-outcome language bilingual", () => {
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");
    for (const key of [
      "entryNode",
      "nodeParticipation",
      "nodeAssessment",
      "assessmentGroup",
      "familyDecisionGroup",
      "conversationOutcome",
      "parentConcerns",
      "route_enrollment_pending",
      "route_continue_follow_up",
      "route_await_product",
    ]) {
      expect(zh).toContain(`\"${key}\"`);
      expect(en).toContain(`\"${key}\"`);
    }
  });
});
