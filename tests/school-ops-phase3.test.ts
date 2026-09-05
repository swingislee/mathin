import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");
const migrationPath = [
  "supabase",
  "migrations",
  "20260905000200_school_ops_phase3_enrollment_handoff.sql",
] as const;

describe("school operations Phase 3 enrollment handoff", () => {
  it("separates course intent, commercial enrollment, and the teaching roster", () => {
    const migration = read(...migrationPath);
    expect(migration).toContain("create table public.course_opportunities");
    expect(migration).toContain("create table public.course_enrollments");
    expect(migration).toContain("create table public.course_enrollment_assignments");
    expect(migration).toContain("references public.enrollments(id)");
    expect(migration).toContain("num_nonnulls(student_id, lead_id) = 1");
    expect(migration).toContain("course_enrollments_one_active_target_idx");
  });

  it("uses one scoped mutation for route- and subject-origin opportunities", () => {
    const migration = read(...migrationPath);
    const action = read("src", "features", "school", "phase3-enrollment-actions.ts");
    const signature = "save_course_opportunity(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid,text,timestamptz,text)";

    expect(migration).toContain("num_nonnulls(p_activity_route_id, p_student_id, p_lead_id) <> 1");
    expect(migration).toContain("num_nonnulls(p_activity_route_id, p_student_id, p_lead_id) <> 0");
    expect(migration).toContain(signature);
    expect(action).toContain("p_activity_route_id");
    expect(action).toContain("p_student_id");
    expect(action).toContain("p_lead_id");
    expect(action).toContain("p_owner_id");
    expect(migration).toContain("coalesce(route.student_id, lead.student_id)");
  });

  it("checks subject scope before a requested owner can replace the derived owner", () => {
    const migration = read(...migrationPath);
    const createBranch = migration.slice(
      migration.indexOf("if p_opportunity_id is null then"),
      migration.indexOf("select opportunity.* into v_opportunity"),
    );
    const scopeCheck = createBranch.indexOf("public.can_access_course_opportunity_subject");
    const ownerReplacement = createBranch.indexOf("v_owner_id := coalesce(p_owner_id");
    expect(scopeCheck).toBeGreaterThan(-1);
    expect(ownerReplacement).toBeGreaterThan(scopeCheck);
    expect(createBranch).toContain("p_owner_id is distinct from v_owner_id");
    expect(createBranch).toContain("FORBIDDEN_OWNER_ASSIGNMENT");

    const updateBranch = migration.slice(
      migration.indexOf("select * into v_opportunity"),
      migration.indexOf("perform public.emit_domain_event", migration.indexOf("select * into v_opportunity")),
    );
    expect(updateBranch.indexOf("public.can_access_course_opportunity_subject")).toBeLessThan(
      updateBranch.indexOf("v_owner_id := coalesce(p_owner_id"),
    );
    expect(updateBranch).toContain("p_owner_id is distinct from v_opportunity.owner_id");
    expect(updateBranch).toContain("FORBIDDEN_OWNER_ASSIGNMENT");
  });

  it("deduplicates by source or subject plus target instead of one route globally", () => {
    const migration = read(...migrationPath);
    expect(migration).not.toContain("source_activity_route_id uuid unique");
    expect(migration).toContain("course_opportunities_route_target_key");
    expect(migration).toContain("course_opportunities_student_target_key");
    expect(migration).toContain("course_opportunities_lead_target_key");
    expect(migration).toContain("if found then return v_opportunity.id; end if;");
  });

  it("keeps enrollment confirmation pending assignment and does not mutate Student lifecycle", () => {
    const migration = read(...migrationPath);
    const confirm = migration.slice(
      migration.indexOf("create or replace function public.confirm_course_enrollment"),
      migration.indexOf("create or replace function public.cancel_course_enrollment"),
    );
    expect(confirm).toContain("stage not in ('committed','payment_pending')");
    expect(confirm).toContain("IDENTITY_NOT_CONFIRMED");
    expect(confirm).toContain("ENROLLMENT_CANCELLED");
    expect(confirm.indexOf("select enrollment.id, enrollment.status")).toBeLessThan(
      confirm.indexOf("stage not in ('committed','payment_pending')"),
    );
    expect(confirm).not.toContain("update public.students");
    expect(confirm).not.toContain("insert into public.enrollments");
  });

  it("writes one effective timestamp across class membership, bridge, and events", () => {
    const migration = read(...migrationPath);
    expect(migration).toContain("p_effective_at timestamptz default now()");
    expect(migration).toContain("'effectiveAt', v_effective_at");
    expect(migration).toContain("left_at = v_effective_at");
    expect(migration).toContain("'active', v_effective_at");
    expect(migration).toContain("note, assigned_by, assigned_at");
    expect(migration).toContain("note, recorded_by, occurred_at");
  });

  it("can claim an unlinked compatible legacy membership and audits legacy closure", () => {
    const migration = read(...migrationPath);
    expect(migration).toContain("MEMBERSHIP_ALREADY_LINKED");
    expect(migration).toContain("roster.term_id is not distinct from v_enrollment.term_id");
    expect(migration).toContain("sync_course_enrollment_assignment_from_membership");
    expect(migration).toContain("membership_transferred_out");
    expect(migration).toContain("membership_withdrawn");
    expect(migration).toContain("membership_completed");
  });

  it("limits cancellation to unassigned enrollment and preserves identity origin", () => {
    const migration = read(...migrationPath);
    expect(migration).toContain("origin_lead_id uuid references public.leads");
    expect(migration).toContain("COURSE_OPPORTUNITY_IDENTITY_CONFLICT");
    expect(migration).toContain("'identity_linked'");
    expect(migration).toContain("create or replace function public.cancel_course_enrollment");
    expect(migration).toContain("ENROLLMENT_STILL_ASSIGNED");
    expect(migration).toContain("'financeMutation', false");
  });

  it("places signup in its source context and renders a capacity board", () => {
    const routes = read("src", "features", "school", "dashboard-routes.ts");
    const nav = read("src", "features", "school", "nav.ts");
    const activityUi = read("src", "features", "school", "ActivityWorkspace.tsx");
    const assessmentUi = read("src", "features", "school", "AssessmentUnifiedWorkbench.tsx");
    const opportunityData = read("src", "features", "school", "phase3-enrollment-data.ts");
    const opportunityUi = read("src", "features", "school", "Phase3CourseOpportunityWorkbench.tsx");
    const enrollmentUi = read("src", "features", "school", "Phase3CourseEnrollmentWorkbench.tsx");
    const enrollmentPage = read("src", "app", "[locale]", "dashboard", "followups", "enrollments", "page.tsx");
    const zh = JSON.parse(read("messages", "zh.json"));
    const en = JSON.parse(read("messages", "en.json"));

    expect(routes).toContain('href: "/dashboard/opportunities"');
    expect(routes).toContain('href: "/dashboard/followups/enrollments"');
    expect(nav).not.toContain('"opportunities"');
    expect(nav).toContain('"followups"');
    expect(nav).not.toContain('"enrollments"');
    expect(activityUi).toContain("EnrollmentHandoffButton");
    expect(assessmentUi).toContain("PostActivityHandoff");
    expect(opportunityData).toContain('source.route !== "await_product"');
    expect(opportunityUi).toContain("confirmCourseEnrollmentAction");
    expect(enrollmentUi).toContain("assignCourseEnrollmentsAction");
    expect(enrollmentUi).toContain("transferCourseEnrollmentAction");
    expect(enrollmentUi).toContain("cancelCourseEnrollmentAction");
    expect(enrollmentPage).toContain('requirePerm(locale, "enrollment.manage")');
    expect(enrollmentPage).toContain("EnrollmentPlacementWorkbench");
    expect(zh.school.courseOpportunities.title).toBe("报班跟进");
    expect(en.school.courseEnrollments.title).toBe("Enrollment assignment");
  });

  it("keeps cancelled commercial enrollments visible as immutable history", () => {
    const migration = read(...migrationPath);
    const workbench = migration.slice(
      migration.indexOf("create or replace function public.get_course_enrollment_workbench"),
      migration.indexOf("create or replace function public.get_phase3_enrollment_options"),
    );
    expect(workbench).toContain("'status', enrollment.status");
    expect(workbench).not.toContain("where enrollment.status = 'active'");
  });
});
