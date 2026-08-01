import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260801000800_r1_data_repair_plans.sql");

describe("R1-7D data repair contracts", () => {
  it("registers explicit domain capabilities without a generic table writer", () => {
    expect(migration).toContain("create table public.data_repair_capability_versions");
    expect(migration).toContain("'order_status_recompute'");
    expect(migration).toContain("'student_merge'");
    expect(migration).toContain("'courseware_asset_replacement_rollback'");
    expect(migration).toContain("'test_data_purge'");
    expect(migration).toContain("'automatic_rollback'");
    expect(migration).toContain("'backup_required'");
    expect(migration).not.toMatch(/execute\s+format/i);
  });

  it("freezes impact, target hash and recovery state before transactional execution", () => {
    expect(migration).toContain("create table public.data_repair_plans");
    expect(migration).toContain("impact_count integer not null");
    expect(migration).toContain("target_hash text not null");
    expect(migration).toContain("recovery_snapshot jsonb not null");
    expect(migration).toContain("REPAIR_TARGET_CHANGED");
    expect(migration).toContain("REPAIR_POSTCONDITION_FAILED");
    expect(migration).toContain("REPAIR_ROLLBACK_POSTCONDITION_FAILED");
    expect(migration).toContain("for update");
  });

  it("keeps the ledger audit-readable and writes immutable lifecycle events", () => {
    expect(migration).toContain("create table public.data_repair_events");
    expect(migration).toContain("data_repair_events_immutable");
    expect(migration).toContain("data_repair_plans_audit_read");
    expect(migration).toContain("system.operations.manage");
    expect(migration).toContain("'data_repair.executed'");
    expect(migration).toContain("'data_repair.rolled_back'");
    expect(migration).toContain("null, '/dashboard/data-maintenance'");
  });

  it("ships the bilingual preview, execute and rollback UI", () => {
    const page = read("src/app/[locale]/dashboard/data-maintenance/page.tsx");
    const panel = read("src/features/school/DataRepairPanel.tsx");
    const action = read("src/features/school/actions/data-repair.ts");
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));
    expect(page).toContain("<DataRepairPanel");
    expect(panel).toContain("previewOrderStatusRepairAction");
    expect(panel).toContain("executeDataRepairPlanAction");
    expect(panel).toContain("rollbackDataRepairPlanAction");
    expect(panel).toContain("AlertDialog");
    expect(action).toContain('authorizedClient("system.operations.manage")');
    expect(zh.school.dataRepair.targetChanged).toBeTruthy();
    expect(en.school.dataRepair.targetChanged).toBeTruthy();
  });

  it("covers stale targets, no partial writes, rollback and negative permissions in SQL", () => {
    const assertions = read("supabase/tests/r1_data_repair_assertions.sql");
    expect(assertions).toContain("R1_7D_STALE_EXECUTION_LEFT_PARTIAL_WRITES");
    expect(assertions).toContain("R1_7D_ROLLBACK_INCOMPLETE");
    expect(assertions).toContain("R1_7D_DUE_REWRITE_PLAN_ACCEPTED");
    expect(assertions).toContain("R1_7D_STUDENT_READ_REPAIR_LEDGER");
    expect(assertions).toContain("R1_7D_REPAIR_CREATED_NOTIFICATION_NOISE");
  });
});
