import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260728000400_r1_account_security.sql");
const roleGuardMigration = read("supabase/migrations/20260815000200_r1_profile_role_update_guard.sql");
const accountCenterMigration = read("supabase/migrations/20260825000800_account_center_profile.sql");

describe("R1-3 account security contracts", () => {
  it("versions exact consent records and rejects duplicate open rights requests without deleting history", () => {
    expect(migration).toContain("create table public.consent_policies");
    expect(migration).toContain("create table public.consent_records");
    expect(migration).toContain("policy_version text not null");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("REQUEST_ALREADY_OPEN");
    expect(migration).not.toContain("account_requests_one_open_idx");
  });

  it("binds one-time staff invitations to email and requires both current consents at signup", () => {
    expect(migration).toContain("create table public.staff_invitations");
    expect(migration).toContain("invitation_row.email = clean_email");
    expect(migration).toContain("CONSENT_REQUIRED");
    expect(migration).toContain("privacy_version");
    expect(migration).toContain("children_version");
  });

  it("enforces lock, current consent, and admin AAL2 in the shared server authorization boundary", () => {
    const auth = read("src/lib/auth.ts");
    const layout = read("src/app/[locale]/dashboard/layout.tsx");
    expect(auth).toContain('account_status === "locked"');
    expect(auth).toContain('rpc("has_current_required_consents"');
    expect(auth).toContain('getAuthenticatorAssuranceLevel()');
    expect(auth).toContain('currentLevel !== "aal2"');
    expect(auth).toContain("hasLocalDevelopmentMfaExemption");
    expect(layout).toContain("allowAccountRecovery: true");
    const securityPage = read("src/app/[locale]/dashboard/account-security/page.tsx");
    expect(securityPage).toContain('role="alert"');
    expect(securityPage).toContain('rawRequired === "mfa" || rawRequired === "consent"');
  });

  it("keeps MFA and session controls in a client leaf while support changes are validated and audited", () => {
    const security = read("src/features/account/AccountSecurityPanel.tsx");
    const actions = read("src/features/account/actions.ts");
    expect(security).toContain('signOut({ scope: "others" })');
    expect(security).toContain("challengeAndVerify");
    expect(security).toContain("data.totp.qr_code.trimEnd()");
    expect(security).toContain("factorData?.all");
    expect(security).toContain("isAdmin && verified.length <= 1");
    expect(actions).toContain("supportTargetSchema");
    expect(actions).toContain("updateUserById");
    expect(actions).toContain('rpc("record_account_support_action"');
  });

  it("ships the provider-independent account center without pretending disabled identity providers work", () => {
    const security = read("src/features/account/AccountSecurityPanel.tsx");
    const accountData = read("src/features/account/account-security.ts");
    const actions = read("src/features/account/actions.ts");
    expect(security).toContain('value="profile"');
    expect(security).toContain('value="identities"');
    expect(security).toContain('value="security"');
    expect(security).toContain('value="privacy"');
    expect(security).toContain('storage.from("profile-avatars").upload');
    expect(security).toContain('<Button type="button" variant="secondary" size="sm" disabled>');
    expect(accountData).toContain('recoveryAvailable: false');
    expect(actions).toContain("accountProfileSchema");
    expect(actions).toContain('value.avatarPath.startsWith(`${user.id}/`)');
    expect(accountCenterMigration).toContain("add column if not exists preferred_locale");
    expect(accountCenterMigration).toContain("profile_avatars_insert_own");
    expect(accountCenterMigration).toContain("entity_type := 'profile_avatar'");
  });

  it("allows trusted identity role changes without opening other protected profile fields", () => {
    expect(roleGuardMigration).toContain("current_setting('app.allow_profile_role_update', true)");
    expect(roleGuardMigration).toMatch(/new\.role is distinct from old\.role[\s\S]*not role_update_allowed/);
    expect(roleGuardMigration).toMatch(/role_update_allowed[\s\S]*new\.account_status is distinct from old\.account_status/);

    const sql = read("supabase/tests/r1_account_security_assertions.sql");
    expect(sql).toContain("R1_DIRECT_PROFILE_ROLE_UPDATE_WAS_ACCEPTED");
    expect(sql).toContain("R1_ROLE_BYPASS_CHANGED_ACCOUNT_STATUS");
    expect(sql).toContain("R1_ADMIN_SET_IDENTITY_ROLE_UPDATE_FAILED");
  });

  it("ships executable Auth, RLS, Storage negatives and a dual-control production recovery contract", () => {
    const sql = read("supabase/tests/r1_account_security_assertions.sql");
    const runbook = read("docs/runbooks/production-admin-recovery.md");
    const schema = JSON.parse(read("schemas/production-admin-manifest.schema.json"));
    expect(sql).toContain("registration gate rejects a bypass");
    expect(sql).toContain("R1_CROSS_USER_RIGHTS_REQUEST_WAS_VISIBLE");
    expect(sql).toContain("R1_CROSS_USER_PRIVATE_STORAGE_WAS_VISIBLE");
    expect(runbook).toContain("两名不同的实际人员");
    expect(runbook).toContain("AAL2");
    expect(schema.properties.environment.const).toBe("production");
    expect(schema.properties.admin.properties.mfa.properties.verifiedFactorCount.minimum).toBe(1);
  });
});
