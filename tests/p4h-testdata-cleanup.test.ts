import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4H-10 test-data bulk archive, CAS report, and controlled permanent cleanup", () => {
  it("defines bulk-archive, CAS zero-reference report and purge-candidate list RPCs", () => {
    const migration = read("supabase", "migrations", "20260720001100_p4h_test_data_cleanup.sql");
    expect(migration).toContain("create or replace function public.bulk_archive_test_classrooms");
    expect(migration).toContain("create or replace function public.list_zero_reference_shared_assets");
    expect(migration).toContain("create or replace function public.list_purgeable_course_families");
    expect(migration).toContain("create or replace function public.list_purgeable_classrooms");
  });

  it("deletes courses before course_families to respect the on-delete-restrict foreign key", () => {
    const migration = read("supabase", "migrations", "20260720001100_p4h_test_data_cleanup.sql");
    const deleteCoursesIndex = migration.indexOf("delete from public.courses where family_id");
    const deleteFamilyIndex = migration.indexOf("delete from public.course_families where id");
    expect(deleteCoursesIndex).toBeGreaterThan(-1);
    expect(deleteFamilyIndex).toBeGreaterThan(-1);
    expect(deleteCoursesIndex).toBeLessThan(deleteFamilyIndex);
  });

  it("gates every purge path behind purpose='test', an existing trashed/soft-deleted state, and an exact name match", () => {
    const migration = read("supabase", "migrations", "20260720001100_p4h_test_data_cleanup.sql");
    expect(migration).toContain("PRODUCTION_DATA_PROTECTED");
    expect(migration).toContain("VARIANT_NOT_TRASHED");
    expect(migration).toContain("CLASSROOM_NOT_TRASHED");
    expect(migration).toContain("NAME_MISMATCH");
    expect(migration).toContain("p_confirm_name <> family_row.title");
    expect(migration).toContain("p_confirm_name <> classroom_row.name");
  });

  it("never grants testdata.purge to any staff role — the purge pathway ships disabled by default", () => {
    const migrationFiles = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
    for (const file of migrationFiles) {
      const content = read("supabase", "migrations", file);
      const insertBlocks = content.match(/insert into public\.role_permissions[\s\S]*?;/g) ?? [];
      for (const block of insertBlocks) {
        expect(block).not.toContain("testdata.purge");
      }
    }
  });

  it("wires purge actions behind the testdata.purge permission key, separate from class.manage", () => {
    const actions = read("src", "features", "school", "actions", "testdata.ts");
    expect(actions).toContain('authorizedClient("testdata.purge")');
    expect(actions).toContain('authorizedClient("class.manage")');
    expect(actions).toContain('rpc("purge_test_course_family"');
    expect(actions).toContain('rpc("purge_test_classroom"');
    expect(actions).toContain('rpc("bulk_archive_test_classrooms"');
  });

  it("requires typing the exact object name before the purge button is enabled, not window.confirm", () => {
    const dialog = read("src", "features", "school", "PurgeConfirmDialog.tsx");
    expect(dialog).not.toContain("window.confirm");
    expect(dialog).toContain("typedName === objectName");
    expect(dialog).toContain("disabled={!matches");
  });

  it("switches the classes list to the bulk-archive panel only for the test scope, not other scopes", () => {
    const page = read("src", "app", "[locale]", "dashboard", "classes", "page.tsx");
    expect(page).toContain('scope.scope === "test"');
    expect(page).toContain("ClassroomTestBulkPanel");
  });

  it("gates the admin cleanup page behind testdata.purge and does not use a client-side delete loop", () => {
    const page = read("src", "app", "[locale]", "dashboard", "operations", "testdata", "page.tsx");
    expect(page).toContain('requirePerm(locale, "testdata.purge")');
    const panel = read("src", "features", "school", "ClassroomTestBulkPanel.tsx");
    expect(panel).toContain("bulkArchiveClassroomsAction");
    expect(panel).not.toMatch(/for\s*\(.*archiveClassroomAction/);
  });
});
