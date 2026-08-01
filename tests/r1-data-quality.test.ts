import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260801000700_r1_data_quality_runs.sql");
const platformBootstrap = read("supabase/ci/00_platform_bootstrap.sql");

describe("R1-7C data quality contracts", () => {
  it("persists an immutable, versioned and RLS-protected quality ledger", () => {
    expect(migration).toContain("create table public.data_quality_rule_versions");
    expect(migration).toContain("create table public.data_quality_runs");
    expect(migration).toContain("create table public.data_quality_findings");
    expect(migration).toContain("QUALITY_RULE_IMMUTABLE");
    expect(migration).toContain("mathin-data-quality-v1");
    expect(migration).toContain("data_quality_rule_set_rule_key_unique");
    expect(migration).toContain("data_quality_runs_audit_read");
    expect(migration).toContain("revoke all on public.data_quality_rule_versions, public.data_quality_runs, public.data_quality_findings");
  });

  it("runs all five detection-only rules in one stable snapshot", () => {
    for (const rule of [
      "orphan_active_enrollment",
      "duplicate_student_phone",
      "illegal_session_state",
      "order_amount_unbalanced",
      "missing_courseware_object",
    ]) expect(migration).toContain(rule);
    expect(migration).toContain("statement_timestamp()");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("findings_hash");
    expect(migration).toContain("extensions.digest");
    expect(migration).toContain("normalizedKeyHash");
    expect(migration).not.toContain("'phone', phone_group.normalized_phone");
  });

  it("reproduces the Supabase pgcrypto schema in standard PostgreSQL CI", () => {
    expect(platformBootstrap).toContain("create schema if not exists extensions");
    expect(platformBootstrap).toContain("create extension if not exists pgcrypto with schema extensions");
    expect(platformBootstrap).toContain("alter database %I set search_path = public, extensions");
  });

  it("exposes the scan through the audit-scoped bilingual maintenance UI", () => {
    const page = read("src/app/[locale]/dashboard/data-maintenance/page.tsx");
    const panel = read("src/features/school/DataQualityPanel.tsx");
    const action = read("src/features/school/actions/data-quality.ts");
    const routes = read("src/features/school/dashboard-routes.ts");
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));
    expect(page).toContain('requirePerm(locale, "audit.view")');
    expect(page).toContain('perms.has("testdata.purge")');
    expect(panel).toContain("runDataQualityScanAction");
    expect(panel).toContain("initialRun");
    expect(panel).toContain("canRun");
    expect(action).toContain('authorizedClient("system.operations.manage")');
    expect(routes).toMatch(/dataMaintenance:[\s\S]*?permission: "audit\.view"/);
    expect(zh.school.dataQuality.rule_duplicate_student_phone).toBeTruthy();
    expect(en.school.dataQuality.rule_duplicate_student_phone).toBeTruthy();
  });

  it("keeps scan events out of the notification feed and ships database assertions", () => {
    const assertions = read("supabase/tests/r1_data_quality_assertions.sql");
    expect(migration).toContain("'data_quality.completed'");
    expect(migration).toContain("), null, '/dashboard/data-maintenance'");
    expect(assertions).toContain("R1_7C_REPEAT_SCAN_NOT_STABLE");
    expect(assertions).toContain("R1_7C_PHONE_LEAKED_IN_EVIDENCE");
    expect(assertions).toContain("R1_7C_STUDENT_READ_QUALITY_LEDGER");
  });
});