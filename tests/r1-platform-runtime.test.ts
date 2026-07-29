import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260728000300_r1_platform_runtime.sql");

describe("R1-2 platform runtime contracts", () => {
  it("persists leases, attempts, exponential retry, dead letters, effects, and replay", () => {
    for (const table of ["jobs", "job_attempts", "job_effects", "job_workers"]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("power(2, greatest(job_row.attempt_count - 1, 0))");
    expect(migration).toContain("dead_lettered_at");
    expect(migration).toContain("create or replace function public.replay_dead_job");
    expect(migration).toContain("unique(job_id, attempt_no)");
  });

  it("uses a first-party notification model with channel delivery history", () => {
    const siteHeader = read("src/components/site-header.tsx");
    const actions = read("src/features/events/notifications.ts");
    expect(migration).toContain("create table public.notifications");
    expect(migration).toContain("create table public.notification_deliveries");
    expect(migration).toContain("domain_events_stage_notification");
    expect(migration).toContain("unique(recipient_id, idempotency_key)");
    expect(siteHeader).toContain("@/features/events/notifications");
    expect(actions).toContain('.from("notifications")');
    expect(actions).toContain('rpc("mark_notifications_read_through"');
  });

  it("governs user files and uses TUS for the large video path", () => {
    const tus = read("src/lib/storage/tus-upload.ts");
    const video = read("src/features/school/ManagedVideoUploadPanel.tsx");
    expect(migration).toContain("create table public.file_policies");
    expect(migration).toContain("create table public.file_upload_sessions");
    expect(migration).toContain("create table public.managed_files");
    expect(migration).toContain("storage_objects_capture_managed");
    expect(migration).toContain("enqueue_file_cleanup_jobs");
    expect(tus).toContain('"tus-resumable": TUS_VERSION');
    expect(tus).toContain('method: "PATCH"');
    expect(video).toContain('bucketId: "session-videos"');
    expect(video).toContain("uploadTusFile");
  });

  it("keeps external providers closed and verifies signed webhooks before the replay ledger", () => {
    const route = read("src/app/api/integrations/webhooks/[provider]/route.ts");
    expect(migration).toContain("integration_enabled_configured");
    expect(migration).toContain("WEBHOOK_REPLAY");
    expect(migration).toContain("WEBHOOK_TIMESTAMP_OUT_OF_RANGE");
    expect(migration).toContain("degraded_until");
    expect(route).toContain("createHmac");
    expect(route).toContain("timingSafeEqual");
    expect(route.indexOf("timingSafeEqual")).toBeLessThan(route.indexOf('rpc("accept_webhook_receipt"'));
  });

  it("exposes bilingual operations metrics and an intentional worker entrypoint", () => {
    const panel = read("src/features/school/PlatformOperationsPanel.tsx");
    const worker = read("scripts/r1-job-worker.mjs");
    const pkg = JSON.parse(read("package.json"));
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));
    expect(panel).toContain('rpc("get_platform_operations_snapshot")');
    expect(panel).toContain("JobReplayButton");
    expect(worker).toContain('rpc("claim_jobs"');
    expect(worker).toContain('rpc("reserve_job_effect"');
    expect(pkg.scripts["jobs:worker"]).toBe("node scripts/r1-job-worker.mjs");
    expect(zh.school.operations.jobRuntimeTitle).toBeTruthy();
    expect(en.school.operations.jobRuntimeTitle).toBeTruthy();
  });
});
