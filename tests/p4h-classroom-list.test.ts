import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4H-8 classroom list, detail tabs and session drawer contract", () => {
  it("keeps the classroom list scope-bounded and never preloads every classroom", () => {
    const page = read("src", "app", "[locale]", "dashboard", "classes", "page.tsx");
    const queries = read("src", "features", "school", "teaching-operations", "classroom-queries.ts");
    const migration = read("supabase", "migrations", "20260720000900_p4h_classroom_list_and_roster_scope.sql");

    expect(page).not.toContain("select(\"*\")");
    expect(queries).toContain("list_classrooms_for_scope");
    expect(queries).toContain("resolve_classroom_scope");
    expect(migration).toContain("create or replace function public.resolve_classroom_scope");
    expect(migration).toContain("create or replace function public.list_classrooms_for_scope");
    expect(migration).toContain("create or replace function public.support_of_student");
    expect(migration).toContain("can_view_enrollment");
    expect(migration).toContain("is_classroom_staff_assigned(cid, uid)");
  });

  it("keeps archived and test fixtures out of ordinary classroom scopes", () => {
    const migration = read("supabase", "migrations", "20260826000700_classroom_fixture_isolation.sql");

    expect(migration).toContain("drop function if exists public.list_classrooms_for_scope");
    expect(migration).toContain("archived_at timestamptz");
    expect(migration).toContain("v_scope = 'test' and classroom_row.purpose = 'test'");
    expect(migration).toContain("v_scope <> 'test'");
    expect(migration).toContain("classroom_row.archived_at is null");
    expect(migration).toContain("classroom_row.purpose = coalesce(v_purpose, 'production')");
    expect(migration).toContain("select pg_notify('pgrst', 'reload schema')");
  });

  it("prefers assigned personal classes, falls back to all only when empty, and scales the all view as a paged table", () => {
    const migration = read("supabase", "migrations", "20260829000100_classroom_personal_scope_default.sql");
    const page = read("src", "app", "[locale]", "dashboard", "classes", "page.tsx");
    const list = read("src", "features", "school", "ClassroomList.tsx");
    const testPanel = read("src", "features", "school", "ClassroomTestBulkPanel.tsx");
    const tableShell = read("src", "features", "school", "dashboard-page", "DashboardCard.tsx");
    const queries = read("src", "features", "school", "teaching-operations", "classroom-queries.ts");
    const sharedTableShell = "overflow-hidden rounded-2xl border border-line bg-card";

    expect(migration).toContain("when has_teaching_class then 'teaching'");
    expect(migration).toContain("when has_support_class then 'support'");
    expect(migration).toContain("when can_view_all then 'all'");
    expect(migration).toMatch(/has_teaching_class[\s\S]*classroom_row\.purpose = 'production'[\s\S]*classroom_row\.archived_at is null/);
    expect(page).toContain("scope.fellBackToAll");
    expect(page).toContain("<ClassroomPagination");
    expect(queries).toContain("CLASSROOM_LIST_PAGE_SIZE = 20");
    expect(list).toContain('scope === "all"');
    expect(list).toContain("<AllClassroomsTable");
    expect(list).toContain("<PersonalClassroomCards");
    expect(list).toContain('data-classroom-table="all"');
    expect(tableShell).toContain(sharedTableShell);
    expect(list).toContain("DashboardTableShell");
    expect(testPanel).toContain("DashboardTableShell");
    expect(list).not.toContain('<div className="border-y border-line">');
    expect(list).toContain("timeZone });");
  });

  it("derives session state from real lifecycle columns instead of a hardcoded default", () => {
    const scopes = read("src", "features", "school", "teaching-operations", "scopes.ts");
    expect(scopes).toContain("export function deriveSessionState");
    expect(scopes).not.toContain('state: "scheduled",');
    expect(scopes).toContain("state: input.state");
  });

  it("consolidates session actions into a single URL-driven drawer that reuses existing dialogs", () => {
    const drawer = read("src", "features", "school", "SessionManagementDrawer.tsx");
    const detailPage = read("src", "app", "[locale]", "dashboard", "classes", "[classId]", "page.tsx");

    // P4I-16 起瘦身为"快速抽屉"（doc19 §15.2）：点名/课评已移交课后 tab 专属表单
    // （见 tests/p4i-16-schedule-drawer.test.ts），此处不再断言 AttendanceDrawer/ReviewDrawer。
    expect(drawer).toContain("SubstituteTeacherDialog");
    expect(drawer).toContain("SessionChangeDialog");
    expect(drawer).toContain("voidSessionAction");
    expect(drawer).toContain("closeHref");
    expect(detailPage).toContain("rawSearchParams.session");
    expect(detailPage).toContain("SessionManagementDrawer");
  });

  it("groups cancelled sessions into a collapsible group instead of a separate recycle-bin route", () => {
    const grouped = read("src", "features", "school", "SessionGroupList.tsx");
    expect(grouped).toContain('"cancelled"');
    expect(grouped).toContain('titleKey="groupCancelled"');
    expect(fs.existsSync(path.join(root, "src", "features", "school", "SessionRecycleBin.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(root, "src", "features", "school", "SessionListPanel.tsx"))).toBe(false);
  });

  it("keeps no third-level session route under the classes detail page", () => {
    const classesDetailDir = path.join(root, "src", "app", "[locale]", "dashboard", "classes", "[classId]");
    const entries = fs.readdirSync(classesDetailDir);
    expect(entries).not.toContain("session");
  });

  it("gates voidSessionAction behind the session.void permission key, separate from class.manage", () => {
    const actions = read("src", "features", "school", "actions", "classes.ts");
    expect(actions).toContain('authorizedClient("session.void")');
    expect(actions).toContain('rpc("void_session"');
  });
});
