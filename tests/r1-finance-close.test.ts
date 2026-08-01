import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260801001000_r1_finance_safe_close.sql");

describe("R1-8 finance safe-close contracts", () => {
  it("locks the release gate and prevents feature-flag-only enablement", () => {
    const panel = read("src/features/school/OrganizationSettingsPanel.tsx");
    const financePage = read("src/app/[locale]/dashboard/finance/page.tsx");
    expect(migration).toContain("create or replace function public.finance_release_gate_open()");
    expect(migration).toContain("as $$ select false $$");
    expect(migration).toContain("FINANCE_RELEASE_CLOSED");
    expect(migration).toContain("feature_flag_finance_release_gate");
    expect(panel).toContain('const financeReleaseClosed = flagKey === "finance.enabled"');
    expect(panel).toContain("disabled={financeReleaseClosed}");
    expect(financePage).toContain('isFeatureEnabled("finance.enabled")');
  });

  it("applies a restrictive read gate to every finance table", () => {
    const tables = [
      "orders", "order_items", "payments", "refunds", "coupons",
      "coupon_grants", "scholarships", "student_accounts", "account_ledger",
    ];
    for (const table of tables) {
      expect(migration).toContain(`create policy finance_release_gate on public.${table} as restrictive`);
    }
    expect(migration).toMatch(/can_view_order[\s\S]*is_feature_enabled\('finance\.enabled'\)/);
    expect(migration).toMatch(/can_view_finance_student[\s\S]*is_feature_enabled\('finance\.enabled'\)/);
  });

  it("blocks and filters finance work items and approvals", () => {
    expect(migration).toContain("work_items_finance_release_gate");
    expect(migration).toContain("approval_requests_finance_release_gate");
    expect(migration).toContain("rename to list_my_work_items_without_finance_gate");
    expect(migration).toContain("item_row.domain <> 'finance'");
    expect(migration).toContain("item_row.action_href not like '/dashboard/finance%'");
  });

  it("keeps finance events auditable without exposing notifications", () => {
    expect(migration).toContain("create or replace function public.is_finance_domain_event");
    expect(migration).toContain("public.is_finance_domain_event(new.id)");
    expect(migration).toMatch(/notifications_own_read[\s\S]*not public\.is_finance_domain_event\(source_event_id\)/);
    expect(migration).toMatch(/notification_deliveries_own_read[\s\S]*not public\.is_finance_domain_event\(notification_row\.source_event_id\)/);
  });

  it("rejects new finance jobs and suppresses legacy queued work before claims", () => {
    expect(migration).toContain("jobs_finance_release_gate");
    expect(migration).toContain("create or replace function public.suppress_closed_finance_jobs()");
    expect(migration).toContain("status = 'cancelled'");
    expect(migration).toContain("rename to claim_jobs_without_finance_gate");
    expect(migration).toMatch(/create or replace function public\.claim_jobs[\s\S]*suppress_closed_finance_jobs/);
  });
});
