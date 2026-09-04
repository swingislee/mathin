import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessmentWorkbenchCounts,
  assessmentWorkbenchRowsForView,
  type AssessmentWorkbenchRow,
} from "@/features/school/assessment-workbench-contract";

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

  it("flows confirmed lead invitations into one aggregate assessment session without creating a student", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260904000200_school_ops_assessment_aggregate_workbench.sql",
    );
    const rlsMigration = read(
      "supabase",
      "migrations",
      "20260904000210_school_ops_assessment_lead_rls_nonrecursive.sql",
    );
    const page = read("src", "app", "[locale]", "dashboard", "assessments", "page.tsx");
    const workbench = read("src", "features", "school", "AssessmentAggregateWorkbench.tsx");
    const actions = read("src", "features", "school", "assessment-workbench-actions.ts");
    const query = read("src", "features", "school", "assessment-workbench-data.ts");
    const routes = read("src", "features", "school", "dashboard-routes.ts");
    const activityProjection = query.slice(
      query.indexOf("const ACTIVITY_COLUMNS"),
      query.indexOf("export async function listAssessmentWorkbenchRows"),
    );

    expect(migration).toContain("activity_registrations_subject_check");
    expect(migration).toContain("assessment_results_subject_check");
    expect(migration).toContain("save_invitation_assessment_row");
    expect(migration).toContain("ensure_invitation_assessment_registration");
    expect(migration).toContain("set state = 'completed'");
    expect(migration).toContain("status, operated_by");
    expect(migration).toContain("'attended'");
    expect(migration).toContain("rebind_lead_assessment_history");
    expect(migration).not.toContain("insert into public.students");
    expect(rlsMigration).toContain("has_assessment_history_lead_access");
    expect(rlsMigration).toContain("public.has_assessment_history_lead_access(id)");
    expect(rlsMigration).not.toContain("p_uid");
    expect(query).toContain('import "server-only"');
    expect(query).toContain('.eq("state", "confirmed")');
    expect(query).toContain('source_invitation_id');
    expect(activityProjection).toContain('].join(",");');
    expect(query).toContain(".select(ACTIVITY_COLUMNS)");
    expect(actions).toContain("save_invitation_assessment_row");
    expect(actions).toContain("save_invitation_assessment_route");
    expect(actions.match(/const result = value\.invitationId/g)).toHaveLength(2);
    expect(page).toContain("AssessmentAggregateWorkbench");
    expect(page).toContain("DashboardCommandTabs");
    expect(workbench).toContain("sessionRows");
    expect(workbench).toContain("sticky left-0 top-0");
    expect(workbench).toContain("color-mix(in srgb, var(--card) 90%, var(--moon))");
    expect(workbench).toContain("saveAssessmentWorkbenchRowAction");
    expect(workbench).toContain("saveAssessmentWorkbenchRouteAction");
    expect(workbench).toContain("quickEntryColumn");
    expect(workbench).toContain("detailTitle");
    expect(workbench).toContain("mountedRef.current = true");
    expect(workbench).not.toContain("lockInvitation");
    expect(routes).toContain('href: "/dashboard/assessments"');
  });

  it("keeps a saved assessment row in the current session while queue counts remain derivable", () => {
    const makeRow = (id: string, recorded: boolean): AssessmentWorkbenchRow => ({
      id,
      invitationId: recorded ? null : `${id}-invitation`,
      registrationId: recorded ? `${id}-registration` : null,
      studentId: recorded ? `${id}-student` : null,
      leadId: recorded ? null : `${id}-lead`,
      name: recorded ? "贝贝" : "安安",
      phone: recorded ? "13800000002" : "13800000001",
      grade: recorded ? 3 : 2,
      gradeText: "",
      scheduledAt: recorded ? "2026-09-05T02:00:00.000Z" : "2026-09-04T09:00:00.000Z",
      location: "一号教室",
      assessorName: "测评老师",
      background: "家长关注计算思路",
      participationStatus: recorded ? "attended" : "booked",
      assessment: recorded ? {
        id: `${id}-assessment`,
        assessmentBand: "a",
        score: 82,
        strengths: "表达清楚",
        focusAreas: "审题",
        parentConcerns: "学习习惯",
        teacherRecommendation: "适合 A 班",
        recommendedClass: "A",
        updatedAt: "2026-09-05T03:00:00.000Z",
      } : null,
      route: null,
      updatedAt: recorded ? "2026-09-05T03:00:00.000Z" : "2026-09-04T08:00:00.000Z",
    });
    const rows = [makeRow("pending", false), makeRow("recorded", true)];

    expect(assessmentWorkbenchCounts(rows)).toEqual({ pending: 1, recorded: 1, all: 2 });
    expect(assessmentWorkbenchRowsForView(rows, { queue: "pending" }, "zh").map((row) => row.id))
      .toEqual(["pending"]);
    expect(assessmentWorkbenchRowsForView(rows, { queue: "recorded", q: "审题" }, "zh").map((row) => row.id))
      .toEqual([]);
    expect(assessmentWorkbenchRowsForView(rows, { queue: "recorded", q: "贝贝" }, "zh").map((row) => row.id))
      .toEqual(["recorded"]);
  });
});
