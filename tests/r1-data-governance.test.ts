import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260801000500_r1_data_import_batches.sql");

describe("R1-7 data governance contracts", () => {
  it("persists an RLS-protected versioned import ledger", () => {
    expect(migration).toContain("create table public.data_import_batches");
    expect(migration).toContain("create table public.data_import_rows");
    expect(migration).toContain("alter table public.data_import_batches enable row level security");
    expect(migration).toContain("alter table public.data_import_rows enable row level security");
    expect(migration).toContain("created_by = (select auth.uid())");
    expect(migration).toContain("revoke all on public.data_import_batches, public.data_import_rows from anon, authenticated");
    expect(migration).toContain("expires_at timestamptz not null default (now() + interval '30 days')");
  });

  it("separates server dry-run from atomic and idempotent application", () => {
    expect(migration).toContain("preview_student_import");
    expect(migration).toContain("apply_student_import");
    expect(migration).toContain("mathin-students-v1");
    expect(migration).toContain("IDEMPOTENCY_CONFLICT");
    expect(migration).toContain("BATCH_HAS_ERRORS");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("row_status = 'duplicate'");
    expect(migration).toContain("update public.data_import_rows set payload = null");
  });

  it("uses validated server actions and the audited two-step UI", () => {
    const actions = read("src/features/school/actions/students.ts");
    const panel = read("src/features/school/ImportStudentsPanel.tsx");
    expect(actions).toContain("previewStudentImportSchema");
    expect(actions).toContain('createHash("sha256")');
    expect(actions).toContain('rpc("preview_student_import"');
    expect(actions).toContain('rpc("apply_student_import"');
    expect(panel).toContain("STUDENT_IMPORT_TEMPLATE_VERSION");
    expect(panel).toContain("downloadTemplate");
    expect(panel).toContain("downloadErrors");
    expect(panel).toContain("previewStudentImportAction");
    expect(panel).toContain("applyStudentImportAction");
    expect(panel).not.toContain("importStudentsAction");
  });

  it("clears expired row payloads through the durable worker cycle", () => {
    const worker = read("scripts/r1-job-worker.mjs");
    const plan = read("docs/plan/25-production-1.0-product-completeness.md");
    expect(migration).toContain("purge_expired_data_import_payloads");
    expect(worker).toContain('rpc("purge_expired_data_import_payloads"');
    expect(plan).toContain("R1-7A 学生 CSV 导入");
    expect(plan).toContain("R1-7E 导出");
  });

  it("keeps import audit events out of the operator notification feed", () => {
    const notificationRepair = read("supabase/migrations/20260801000600_r1_data_import_notification_noise.sql");
    expect(notificationRepair).toContain("domain_events_clear_data_import_target");
    expect(notificationRepair).toContain("data_import.validated");
    expect(notificationRepair).toContain("data_import.completed");
    expect(notificationRepair).toContain("new.target_user_id := null");
  });
});
