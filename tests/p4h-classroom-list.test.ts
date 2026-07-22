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

  it("derives session state from real lifecycle columns instead of a hardcoded default", () => {
    const scopes = read("src", "features", "school", "teaching-operations", "scopes.ts");
    expect(scopes).toContain("export function deriveSessionState");
    expect(scopes).not.toContain('state: "scheduled",');
    expect(scopes).toContain("state: input.state");
  });

  it("consolidates session actions into a single URL-driven drawer that reuses existing dialogs", () => {
    const drawer = read("src", "features", "school", "SessionManagementDrawer.tsx");
    const detailPage = read("src", "app", "[locale]", "dashboard", "classes", "[id]", "page.tsx");

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
    expect(grouped).toContain("cancelledGroup");
    expect(fs.existsSync(path.join(root, "src", "features", "school", "SessionRecycleBin.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(root, "src", "features", "school", "SessionListPanel.tsx"))).toBe(false);
  });

  it("keeps no third-level session route under the classes detail page", () => {
    const classesDetailDir = path.join(root, "src", "app", "[locale]", "dashboard", "classes", "[id]");
    const entries = fs.readdirSync(classesDetailDir);
    expect(entries).not.toContain("session");
  });

  it("gates voidSessionAction behind the session.void permission key, separate from class.manage", () => {
    const actions = read("src", "features", "school", "actions", "classes.ts");
    expect(actions).toContain('authorizedClient("session.void")');
    expect(actions).toContain('rpc("void_session"');
  });
});
