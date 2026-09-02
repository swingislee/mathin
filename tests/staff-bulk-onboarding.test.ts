import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDelimitedText } from "@/features/school/delimited-text";
import {
  IGNORED_SOURCE_ROLE,
  initialMofaxiaoRoleMappings,
  mapMofaxiaoRoles,
  parseStaffImportSource,
} from "@/features/school/staff-import-source";
import {
  canonicalizeStaffRoleTokens,
  hasLegacyStaffRoleSeparator,
  splitStaffRoleInput,
  staffRoleDisplayName,
} from "@/features/school/staff-role-input";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("DEV-STAFF-ONBOARD-1 bulk staff provisioning", () => {
  it("parses CSV and TSV without breaking quoted cells or source line numbers", () => {
    expect(parseDelimitedText('\uFEFF姓名,手机号或邮箱,岗位角色\r\n"王,老师",13800000000,"教师 教研"')).toEqual([
      { line: 1, cells: ["姓名", "手机号或邮箱", "岗位角色"] },
      { line: 2, cells: ["王,老师", "13800000000", "教师 教研"] },
    ]);
    expect(parseDelimitedText('name\tidentifier\troles\n"A\nTeacher"\tteacher@example.com\tteacher')).toEqual([
      { line: 1, cells: ["name", "identifier", "roles"] },
      { line: 2, cells: ["A\nTeacher", "teacher@example.com", "teacher"] },
    ]);
    expect(parseDelimitedText(
      "英语B\t17777777774\t未知\t前台,教务,面授（直播）主讲,校区主管,招生,学管师,课程顾问,财务,直播助教",
    )).toEqual([{
      line: 1,
      cells: [
        "英语B",
        "17777777774",
        "未知",
        "前台,教务,面授（直播）主讲,校区主管,招生,学管师,课程顾问,财务,直播助教",
      ],
    }]);
  });

  it("detects pasted Mofaxiao rows, ignores Markdown separators, and requires explicit unsafe mappings", () => {
    const clipboard = parseStaffImportSource(
      "英语B\t17777777774\t未知\t前台,教务,面授（直播）主讲,校区主管,招生,学管师,课程顾问,财务,直播助教",
    );
    expect(clipboard.format).toBe("mofaxiao");
    expect(clipboard.rows[0].sourceRoles).toEqual([
      "前台",
      "教务",
      "面授（直播）主讲",
      "校区主管",
      "招生",
      "学管师",
      "课程顾问",
      "财务",
      "直播助教",
    ]);

    const source = parseStaffImportSource([
      "| 英语D | 17777777776 | 未知 | 面授（直播）主讲 |",
      "| ------ | ----------- | -- | ------------------ |",
      "| 英语B | 17777777774 | 未知 | 前台,教务,面授（直播）主讲,校区主管,招生,学管师,课程顾问,财务,直播助教 |",
    ].join("\n"));

    expect(source.format).toBe("mofaxiao");
    expect(source.rows).toHaveLength(2);
    expect(source.rows[0]).toMatchObject({
      line: 1,
      name: "英语D",
      identifier: "17777777776",
      gender: "未知",
      sourceRoles: ["面授（直播）主讲"],
    });
    expect(source.rows[1].sourceRoles).toContain("财务");

    const mappings = initialMofaxiaoRoleMappings(source.sourceRoles);
    expect(mappings["面授（直播）主讲"]).toBe("teacher");
    expect(mappings["前台"]).toBe("");
    expect(mappings["财务"]).toBe("");

    const unresolved = mapMofaxiaoRoles(source.rows[1].sourceRoles, mappings);
    expect(unresolved.roles).toEqual(["registrar", "teacher", "director", "sales", "part_time"]);
    expect(unresolved.unresolved).toEqual(["前台", "财务"]);

    const reviewed = mapMofaxiaoRoles(source.rows[1].sourceRoles, {
      ...mappings,
      "前台": IGNORED_SOURCE_ROLE,
      "财务": IGNORED_SOURCE_ROLE,
    });
    expect(reviewed.unresolved).toEqual([]);
    expect(reviewed.roles).toEqual(["registrar", "teacher", "director", "sales", "part_time"]);
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

  it("keeps ImportBatch preview while switching apply to trusted direct Auth provisioning", () => {
    const baseMigration = read("supabase/migrations/20260902000700_staff_bulk_onboarding.sql");
    const migration = read("supabase/migrations/20260902001000_staff_direct_provisioning.sql");
    const hardeningMigration = read("supabase/migrations/20260902001100_staff_initial_password_hardening.sql");
    const actions = read("src/features/school/actions/staff-imports.ts");
    expect(baseMigration).toContain("check (import_kind in ('students', 'staff'))");
    expect(migration).toContain("create or replace function public.preview_staff_account_import");
    expect(migration).toContain("provisioning_mode text not null default 'claim'");
    expect(migration).toContain("create or replace function public.prepare_staff_import_account");
    expect(migration).toContain("create or replace function public.finalize_staff_import_account");
    expect(migration).toContain("raise exception 'DIRECT_PROVISIONING_REQUIRED'");
    expect(migration).not.toContain("insert into auth.users");
    expect(actions).toContain("admin.auth.admin.createUser");
    expect(actions).toContain('authorizedClient("staff.invite")');
    expect(actions).not.toContain("initial_password text");
    expect(hardeningMigration).toContain("on_auth_user_invite_secret_scrubbed");
    expect(hardeningMigration).toContain("raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'registration_invite_code'");
  });

  it("creates a schedulable staff profile immediately but closes self-service permissions until password change", () => {
    const migration = read("supabase/migrations/20260902001000_staff_direct_provisioning.sql");
    expect(migration).toContain("password_change_required boolean not null default false");
    expect(migration).toContain("uid is distinct from auth.uid() or not profile_row.password_change_required");
    expect(migration).toContain("case when staff_invite.id is null then 'student' else 'staff' end");
    expect(migration).toContain("case when is_direct then null else now() end");
    expect(migration).toContain("perform public.complete_staff_import_row");
    expect(migration).toContain("permission_row.perm_key = 'permission.configure'");
    expect(migration).toContain("grant execute on function public.complete_initial_password_change(uuid) to service_role");
    expect(migration).not.toMatch(/initial_password\s+text/);
  });

  it("reissues a lost initial password only while first-password change is still pending", () => {
    const migration = read("supabase/migrations/20260902001200_staff_initial_password_reissue.sql");
    const actions = read("src/features/school/actions/staff.ts");
    const panel = read("src/features/school/StaffMembersPanel.tsx");
    expect(migration).toContain("create table public.staff_initial_password_reissues");
    expect(migration).toContain("and target_profile.password_change_required");
    expect(migration).toContain("raise exception 'INITIAL_PASSWORD_NOT_REQUIRED'");
    expect(migration).toContain("raise exception 'PASSWORD_REISSUE_IN_PROGRESS'");
    expect(migration).toContain("where target_user_id = p_user_id and status = 'prepared'");
    expect(migration).toContain("grant execute on function public.prepare_staff_initial_password_reissue(uuid, uuid, text) to service_role");
    expect(migration).not.toMatch(/initial_password\s+text/);
    expect(actions).toContain("reissueStaffInitialPasswordAction");
    expect(actions).toContain("admin.auth.admin.updateUserById");
    expect(actions).toContain('authorizedClient("staff.invite")');
    expect(panel).toContain("member.passwordChangeRequired");
    expect(panel).toContain("reissueInitialPasswordOneTime");
  });

  it("exposes direct account creation, one-time password handoff, and a forced first-login dialog", () => {
    const page = read("src/app/[locale]/dashboard/staff/page.tsx");
    const panel = read("src/features/school/StaffBulkInvitePanel.tsx");
    const actions = read("src/features/school/actions/staff-imports.ts");
    const auth = read("src/lib/auth.ts");
    const accountPage = read("src/app/[locale]/dashboard/account-security/page.tsx");
    const accountPanel = read("src/features/account/AccountSecurityPanel.tsx");
    const accountActions = read("src/features/account/actions.ts");
    const supportPanel = read("src/features/account/AccountSupportPanel.tsx");
    expect(page).toContain("listRecentStaffImportBatches");
    expect(page).toContain('["staff.invite", "staff.manage"]');
    expect(page).toContain('canInviteStaff={perms.has("staff.invite")}');
    expect(panel).toContain("previewStaffImportAction");
    expect(panel).toContain("applyStaffImportAction");
    expect(panel).toContain("duplicatesReviewed");
    expect(panel).toContain("downloadCredentials");
    expect(panel).toContain("codesAvailable");
    expect(panel).toContain("staff-initial-passwords-");
    expect(panel).toContain('locale === "zh" ? "教师 教研" : "teacher research"');
    expect(panel).not.toContain("crypto.randomUUID");
    expect(panel).not.toContain("<table");
    expect(actions).toContain('authorizedClient("staff.invite")');
    expect(actions).toContain('.select("key,name")');
    expect(actions).toContain("canonicalizeStaffRoleTokens");
    expect(auth).toContain("dashboard/account-security?required=password");
    expect(accountPage).toContain("forcePasswordChange={profile.passwordChangeRequired}");
    expect(accountPanel).toContain("showCloseButton={false}");
    expect(accountPanel).toContain("onEscapeKeyDown={(event) => event.preventDefault()}");
    expect(accountActions).toContain("changeInitialPasswordAction");
    expect(accountActions).toContain("SAME_AS_INITIAL");
    expect(supportPanel).toContain('href="/dashboard/staff"');
    expect(supportPanel).not.toContain("issueStaffInvitationAction");
    expect(read("messages/zh.json")).toContain('"bulkCredentialsWarning"');
    expect(read("messages/en.json")).toContain('"bulkCredentialsWarning"');
  });
});
