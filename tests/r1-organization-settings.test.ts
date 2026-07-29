import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260728000100_r1_organization_settings.sql");
const publishGuard = read("supabase/migrations/20260728000200_r1_public_publish_guard.sql");

describe("R1-1 organization settings contracts", () => {
  it("ships explicit organization, campus, calendar, rule, and flag schema with RLS", () => {
    for (const table of ["organizations", "campuses", "campus_rooms", "school_holidays", "organization_rule_versions", "feature_flag_versions"]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("organization_rule_versions_immutable");
    expect(migration).toContain("feature_flag_versions_immutable");
    expect(migration).toContain("oldValue");
    expect(migration).toContain("effective_from");
  });

  it("keeps capabilities fail-closed and gates finance at database and application boundaries", () => {
    const auth = read("src/lib/auth.ts");
    const financePage = read("src/app/[locale]/dashboard/finance/page.tsx");
    const notebookActions = read("src/features/notebook/actions.ts");
    const notebookTopbar = read("src/features/notebook/workspace/WorkspaceTopbar.tsx");
    const layout = read("src/app/[locale]/dashboard/layout.tsx");
    expect(migration).toContain("coalesce((");
    expect(migration).toContain("), false)");
    expect(migration).toContain("p_key not like 'finance.%' or public.is_feature_enabled('finance.enabled')");
    expect(migration).toMatch(/get_my_orders\(\)[\s\S]*is_feature_enabled\('finance\.enabled'\)/);
    expect(auth).toContain('rpc("get_my_permission_keys")');
    expect(financePage).toContain('isFeatureEnabled("finance.enabled")');
    expect(layout).toContain('item.href !== "/dashboard/finance" || financeEnabled');
    expect(publishGuard).toContain("public.is_feature_enabled('public_content.publish')");
    expect(publishGuard).toContain('create policy "posts_insert_own"');
    expect(publishGuard).toContain('create policy "posts_update_own"');
    expect(notebookActions).toContain('p_flag_key: "public_content.publish"');
    expect(notebookTopbar).toContain('t("publishDisabled")');
  });

  it("uses generated defaults instead of test fixture UUIDs", () => {
    expect(migration).not.toContain("00000000-0000-4000-8000-000000000001");
    expect(migration).not.toContain("ci-admin@mathin.local");
    expect(migration).toContain("default gen_random_uuid()");
    expect(migration).toContain("R1-1 explicit default");
    expect(migration).toContain("R1-1 fail-closed default");
  });

  it("registers a bilingual, permission-gated singleton route", () => {
    const routes = read("src/features/school/dashboard-routes.ts");
    const page = read("src/app/[locale]/dashboard/organization-settings/page.tsx");
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));
    expect(routes).toContain('href: "/dashboard/organization-settings"');
    expect(routes).toContain('permission: "organization.settings.manage"');
    expect(page).toContain('requirePerm(locale, "organization.settings.manage")');
    expect(zh.school.organization.title).toBeTruthy();
    expect(en.school.organization.title).toBeTruthy();
  });
});
