import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDelimitedText } from "@/features/school/delimited-text";
import {
  canonicalizeStaffRoleTokens,
  hasLegacyStaffRoleSeparator,
  splitStaffRoleInput,
  staffRoleDisplayName,
} from "@/features/school/staff-role-input";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("DEV-STAFF-ONBOARD-1 bulk staff invitations", () => {
  it("parses CSV and TSV without breaking quoted cells or source line numbers", () => {
    expect(parseDelimitedText('\uFEFF姓名,手机号或邮箱,岗位角色\r\n"王,老师",13800000000,"教师 教研"')).toEqual([
      { line: 1, cells: ["姓名", "手机号或邮箱", "岗位角色"] },
      { line: 2, cells: ["王,老师", "13800000000", "教师 教研"] },
    ]);
    expect(parseDelimitedText('name\tidentifier\troles\n"A\nTeacher"\tteacher@example.com\tteacher')).toEqual([
      { line: 1, cells: ["name", "identifier", "roles"] },
      { line: 2, cells: ["A\nTeacher", "teacher@example.com", "teacher"] },
    ]);
  });

  it("uses spaces between localized role names and resolves them to stable keys", () => {
    const roles = [
      { key: "teacher", name: "教师" },
      { key: "research", name: "教研" },
    ];
    expect(splitStaffRoleInput("教师   教研")).toEqual(["教师", "教研"]);
    expect(splitStaffRoleInput("教师,教研")).toEqual(["教师,教研"]);
    expect(hasLegacyStaffRoleSeparator("教师 教研")).toBe(false);
    expect(hasLegacyStaffRoleSeparator("教师,教研")).toBe(true);
    expect(canonicalizeStaffRoleTokens(["教师", "教研"], roles)).toEqual(["teacher", "research"]);
    expect(canonicalizeStaffRoleTokens(["TEACHER"], roles)).toEqual(["teacher"]);
    expect(staffRoleDisplayName("teacher", roles, "zh")).toBe("教师");
    expect(staffRoleDisplayName("teacher", roles, "en")).toBe("teacher");
  });

  it("uses the shared ImportBatch ledger and never creates Auth users", () => {
    const migration = read("supabase/migrations/20260902000700_staff_bulk_onboarding.sql");
    expect(migration).toContain("check (import_kind in ('students', 'staff'))");
    expect(migration).toContain("create or replace function public.preview_staff_import");
    expect(migration).toContain("create or replace function public.apply_staff_import");
    expect(migration).toContain("if v_batch.error_rows > 0 then raise exception 'BATCH_HAS_ERRORS'");
    expect(migration).toContain("raise exception 'BATCH_STALE'");
    expect(migration).toContain("from public.issue_staff_identity_invitation(");
    expect(migration).not.toContain("insert into auth.users");
  });

  it("applies approved roles only after invitation acceptance and protects privileged roles", () => {
    const migration = read("supabase/migrations/20260902000700_staff_bulk_onboarding.sql");
    expect(migration).toContain("staff_invitation_role_assignments");
    expect(migration).toContain("after update of status, accepted_by on public.staff_invitations");
    expect(migration).toContain("permission_row.perm_key = 'permission.configure'");
    expect(migration).toContain("or public.is_admin(assignment.assigned_by)");
    expect(migration).toContain("update public.data_import_rows\n     set payload = null");
  });

  it("exposes a two-step bilingual UI and one-time credential download", () => {
    const page = read("src/app/[locale]/dashboard/staff/page.tsx");
    const panel = read("src/features/school/StaffBulkInvitePanel.tsx");
    const actions = read("src/features/school/actions/staff-imports.ts");
    expect(page).toContain("listRecentStaffImportBatches");
    expect(panel).toContain("previewStaffImportAction");
    expect(panel).toContain("applyStaffImportAction");
    expect(panel).toContain("duplicatesReviewed");
    expect(panel).toContain("downloadCredentials");
    expect(panel).toContain("codesAvailable");
    expect(panel).toContain('locale === "zh" ? "教师 教研" : "teacher research"');
    expect(panel).not.toContain("crypto.randomUUID");
    expect(panel).not.toContain("<table");
    expect(actions).toContain('authorizedClient("staff.manage")');
    expect(actions).toContain('.select("key,name")');
    expect(actions).toContain("canonicalizeStaffRoleTokens");
    expect(read("messages/zh.json")).toContain('"bulkCredentialsWarning"');
    expect(read("messages/en.json")).toContain('"bulkCredentialsWarning"');
  });
});
