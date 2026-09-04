import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decryptWebPushSubscription,
  encryptWebPushSubscription,
  fingerprintWebPushEndpoint,
  normalizeBrowserPushSubscription,
  validateWebPushEndpoint,
} from "../src/features/events/web-push-runtime.mjs";
import {
  buildGenericWebPushPayload,
  classifyWebPushFailure,
  parseRetryAfterSeconds,
  webPushTtlSeconds,
} from "../scripts/lib/web-push-delivery.mjs";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migrationPath = "supabase/migrations/20260903000750_employee_web_push_dark_runtime.sql";

const subscription = {
  endpoint: "https://push.example.test/subscriptions/device-capability-token",
  expirationTime: null,
  keys: {
    p256dh: "BEl6u7s4I4H8cZmZq1YcA0qvS5JrW8gE3mL2nK9pQ7xV6bN5dF4hT3uR2wX1yZ0a",
    auth: "dGVzdC1hdXRoLWtleQ",
  },
};

describe("employee desktop Web Push production foundation", () => {
  it("encrypts capability URLs and detects ciphertext tampering", () => {
    const encryptionKey = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptWebPushSubscription(subscription, encryptionKey);
    expect(encrypted).not.toContain("push.example.test");
    expect(decryptWebPushSubscription(encrypted, encryptionKey)).toEqual(subscription);

    const tampered = Buffer.from(encrypted, "base64");
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptWebPushSubscription(tampered.toString("base64"), encryptionKey))
      .toThrow("WEB_PUSH_ENVELOPE_INVALID");
  });

  it("uses keyed fingerprints and an exact HTTPS origin allowlist", () => {
    const secret = "test-fingerprint-secret-that-is-long-enough";
    const fingerprint = fingerprintWebPushEndpoint(subscription.endpoint, secret);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain("example");
    expect(validateWebPushEndpoint(subscription.endpoint, "https://push.example.test"))
      .toBe(subscription.endpoint);
    expect(() => validateWebPushEndpoint(subscription.endpoint, "https://other.example.test"))
      .toThrow("WEB_PUSH_ORIGIN_NOT_ALLOWED");
    expect(() => validateWebPushEndpoint("https://127.0.0.1/push/token", "https://127.0.0.1"))
      .toThrow("WEB_PUSH_ENDPOINT_INVALID");
    expect(() => validateWebPushEndpoint("http://push.example.test/push/token", "https://push.example.test"))
      .toThrow("WEB_PUSH_ENDPOINT_INVALID");
  });

  it("normalizes only complete browser subscriptions", () => {
    expect(normalizeBrowserPushSubscription(subscription, ["https://push.example.test"]))
      .toEqual(subscription);
    expect(() => normalizeBrowserPushSubscription({ ...subscription, keys: { auth: "short" } }, ["https://push.example.test"]))
      .toThrow("VALIDATION");
  });

  it("classifies provider responses without copying endpoint details into errors", () => {
    expect(classifyWebPushFailure({ statusCode: 410 })).toMatchObject({ kind: "gone", retryable: false });
    expect(classifyWebPushFailure({ statusCode: 403 })).toMatchObject({ kind: "auth", retryable: false });
    expect(classifyWebPushFailure({ statusCode: 413 })).toMatchObject({ kind: "terminal", retryable: false });
    expect(classifyWebPushFailure({ statusCode: 503 })).toMatchObject({ kind: "retry", retryable: true });
    expect(classifyWebPushFailure({ statusCode: 429, headers: { "retry-after": "90" } }))
      .toMatchObject({ kind: "retry", retryAfterSeconds: 90 });
    expect(parseRetryAfterSeconds("999999")).toBe(4 * 60 * 60);
  });

  it("builds a generic, bounded payload with no business content", () => {
    const now = Date.now();
    const payload = buildGenericWebPushPayload({
      deliveryId: "00000000-0000-4000-8000-000000000001",
      locale: "zh",
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    expect(JSON.parse(payload)).toEqual({
      v: 1,
      deliveryId: "00000000-0000-4000-8000-000000000001",
      locale: "zh",
      expiresAt: expect.any(Number),
    });
    expect(payload).not.toMatch(/student|class|finance|deepLink|endpoint/i);
    expect(webPushTtlSeconds(new Date(now + 60_000).toISOString(), now)).toBe(60);
  });

  it("keeps the database dark by default and stores device-level delivery references only", () => {
    const migration = read(migrationPath);
    expect(migration).toContain("'notifications.web_push', 1, false");
    expect(migration).toContain("'web_push', 'web-push', 'disabled', null");
    expect(migration).toContain("create table public.web_push_subscriptions");
    expect(migration).toContain("create table public.notification_push_rollout_members");
    expect(migration).toContain("encrypted_payload text");
    expect(migration).toContain("create unique index web_push_subscriptions_active_endpoint_idx");
    expect(migration).toContain("jsonb_build_object('deliveryId', delivery_id)");
    expect(migration).not.toContain("jsonb_build_object('deliveryId', delivery_id, 'endpoint'");
    expect(migration).toContain("alter table public.web_push_subscriptions enable row level security");
    expect(migration).toContain("revoke all on public.web_push_subscriptions");
    expect(migration).toContain("create or replace function public.fail_web_push_job");
    expect(migration).toContain("floor(random() * greatest(exponential_cap, 1))");
  });

  it("uses a notification-only Service Worker with local duplicate suppression", () => {
    const serviceWorker = read("public/notification-sw.js");
    expect(serviceWorker).toContain('self.addEventListener("push"');
    expect(serviceWorker).toContain('self.addEventListener("notificationclick"');
    expect(serviceWorker).toContain("mathin-notification-runtime");
    expect(serviceWorker).toContain("reserveDelivery");
    expect(serviceWorker).toContain("showNotification");
    expect(serviceWorker).toContain("/dashboard/notifications/");
    expect(serviceWorker).not.toContain('addEventListener("fetch"');
    expect(serviceWorker).not.toContain("caches.open");
    expect(serviceWorker).not.toContain("importScripts");
  });

  it("keeps desktop notification management in account navigation and a single bell-header switch", () => {
    const accountPage = read("src/app/[locale]/dashboard/account-security/page.tsx");
    const accountPanel = read("src/features/account/AccountSecurityPanel.tsx");
    const bell = read("src/features/events/ChangeBell.tsx");
    const controls = read("src/features/events/DesktopNotificationControls.tsx");

    expect(accountPage).not.toContain("DesktopNotificationControls");
    expect(accountPanel).toContain('value="desktopNotifications"');
    expect(accountPanel).toContain('<DesktopNotificationControls variant="full" />');
    expect(bell.match(/<DesktopNotificationControls/g)).toHaveLength(1);
    expect(bell.indexOf('<DesktopNotificationControls variant="toggle" />'))
      .toBeLessThan(bell.indexOf("<Tabs defaultValue="));
    expect(controls).toContain('role="switch"');
  });

  it("keeps the worker fail-closed and loads the provider only after channel checks", () => {
    const worker = read("scripts/r1-job-worker.mjs");
    const deploy = read("scripts/ops/deploy-mathin-linux.sh");
    expect(worker).toContain('job.kind === "notification.web_push"');
    expect(worker).toContain('rpc("notification_channel_enabled"');
    expect(worker).toContain('import("web-push")');
    expect(worker.indexOf('rpc("notification_channel_enabled"')).toBeLessThan(worker.indexOf("await webPushClient()"));
    expect(worker).toContain("decryptWebPushSubscription");
    expect(worker).toContain("constantTimeStringEqual");
    expect(worker).toContain("fail_web_push_job");
    expect(deploy).toContain('copy_worker_package "web-push"');
    expect(deploy).toContain('cp -a "$source_root/scripts/r1-job-worker.mjs"');
    expect(read("src/features/school/PlatformOperationsPanel.tsx")).toContain("snapshot.webPush ??");
  });

  it("records broad employee-test windows and makes P5 the active construction target", () => {
    const plan = read("docs/plan/employee-desktop-web-push.md");
    const roadmap = read("docs/plan/04-roadmap.md");
    expect(plan).toContain("当前施工目标");
    expect(plan).toContain("连续推进 `PUSH-P0`～`PUSH-P5`");
    expect(plan).toContain("周级或月级意向窗口");
    expect(plan).not.toContain("T0 + 7～10 个工作日");
    expect(roadmap).toContain("LOCAL DARK RUNTIME VERIFIED / PUSH-P5 PENDING");
  });
});
