import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptWebPushSubscription, fingerprintWebPushEndpoint } from "../src/features/events/web-push-runtime.mjs";

const mock = vi.hoisted(() => ({
  client: {} as Record<string, unknown>,
  send: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => mock.client }));
vi.mock("web-push", () => ({ default: { sendNotification: mock.send } }));

type Row = Record<string, unknown>;
const deliveryId = "00000000-0000-4000-8000-000000000001";
const subscriptionId = "00000000-0000-4000-8000-000000000002";
const recipientId = "00000000-0000-4000-8000-000000000003";
const notificationId = "00000000-0000-4000-8000-000000000004";
const job = { job_id: "00000000-0000-4000-8000-000000000005", lease_token: "test-lease",
  effect_key: "test-push-effect", kind: "notification.web_push", payload: { deliveryId } };
const key = Buffer.alloc(32, 19).toString("base64");
const fingerprintSecret = "test-only-secret-with-more-than-thirty-two-bytes";
const browserSubscription = { endpoint: "https://wns2-sg2p.notify.windows.com/device/test-only-capability",
  expirationTime: null, keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } };
let rows: Record<string, Row>;
let eligible: boolean;
let enabled: boolean;
let failStatus: string;
let rpc: ReturnType<typeof vi.fn>;

function table(name: string) {
  const filters: Array<[string, unknown]> = [];
  let changes: Row | undefined;
  const execute = () => {
    const row = rows[name];
    const matches = row && filters.every(([key, value]) => row[key] === value);
    if (matches && changes) Object.assign(row, changes);
    return { data: matches ? { ...row } : null, error: null };
  };
  const builder = {
    select: () => builder,
    update: (value: Row) => { changes = value; return builder; },
    eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
    maybeSingle: async () => execute(),
    then: (resolve: (value: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
  };
  return builder;
}

beforeEach(() => {
  vi.resetModules();
  mock.send.mockReset().mockResolvedValue({ statusCode: 201 });
  const future = new Date(Date.now() + 3600000).toISOString();
  rows = {
    notifications: { id: notificationId, recipient_id: recipientId, archived_at: null },
    notification_deliveries: { id: deliveryId, notification_id: notificationId, recipient_id: recipientId,
      subscription_id: subscriptionId, channel: "web_push", status: "queued", attempt_count: 0, expires_at: future },
    web_push_subscriptions: { id: subscriptionId, recipient_id: recipientId, status: "active", locale: "zh",
      browser_family: "edge", platform_family: "windows",
      encryption_key_version: 1, vapid_key_version: 1, lease_expires_at: future,
      encrypted_payload: encryptWebPushSubscription(browserSubscription, key),
      endpoint_fingerprint: fingerprintWebPushEndpoint(browserSubscription.endpoint, fingerprintSecret) },
    integration_channels: { channel: "web_push", status: "enabled" },
  };
  eligible = true; enabled = true; failStatus = "retry";
  rpc = vi.fn(async (name: string) => {
    if (name === "claim_web_push_jobs") return { data: [job], error: null };
    if (name === "reserve_job_effect") return { data: true, error: null };
    if (name === "is_web_push_recipient_eligible") return { data: eligible, error: null };
    if (name === "notification_channel_enabled") return { data: enabled, error: null };
    if (name === "fail_web_push_job") return { data: failStatus, error: null };
    return { data: null, error: null };
  });
  mock.client = { rpc, from: table };
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:35421");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-only-placeholder");
  vi.stubEnv("R1_JOB_SCOPE", "web_push");
  vi.stubEnv("R1_JOB_ONCE", "1");
  vi.stubEnv("MATHIN_WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY", key);
  vi.stubEnv("MATHIN_WEB_PUSH_FINGERPRINT_SECRET", fingerprintSecret);
  vi.stubEnv("MATHIN_WEB_PUSH_ENCRYPTION_KEY_VERSION", "1");
  vi.stubEnv("MATHIN_WEB_PUSH_VAPID_KEY_VERSION", "1");
  vi.stubEnv("MATHIN_WEB_PUSH_ALLOWED_ORIGINS", "https://wns2-sg2p.notify.windows.com");
  vi.stubEnv("MATHIN_WEB_PUSH_VAPID_SUBJECT", "https://mathin.example.test");
  vi.stubEnv("MATHIN_WEB_PUSH_VAPID_PUBLIC_KEY", "test-public");
  vi.stubEnv("MATHIN_WEB_PUSH_VAPID_SECRET", "test-private");
  vi.stubEnv("MATHIN_WEB_PUSH_PROXY", "");
});
afterEach(() => vi.unstubAllEnvs());

async function run() { await import("../scripts/r1-job-worker.mjs"); }

describe("actual Web Push sender with isolated provider", () => {
  it.each(["encryption_key_version", "vapid_key_version"])("rejects stale %s before sending", async (field) => {
    rows.web_push_subscriptions[field] = 2;
    await run();
    expect(mock.send).not.toHaveBeenCalled();
    expect(rows.notification_deliveries.error_code).toBe("WEB_PUSH_KEY_VERSION_MISMATCH");
  });
  it("sends a generic payload and completes the durable effect", async () => {
    await run();
    expect(mock.send).toHaveBeenCalledTimes(1);
    const [, payload] = mock.send.mock.calls[0];
    expect(Object.keys(JSON.parse(payload)).sort()).toEqual(["deliveryId", "expiresAt", "locale", "v"]);
    expect(rows.notification_deliveries.status).toBe("sent");
    expect(rpc.mock.calls.some(([name]) => name === "complete_job_effect")).toBe(true);
  });

  it("keeps Edge delivery direct even if an old push proxy variable exists", async () => {
    vi.stubEnv("MATHIN_WEB_PUSH_PROXY", "http://127.0.0.1:18080");
    await run();
    expect(mock.send.mock.calls[0][2]).not.toHaveProperty("proxy");
  });

  it.each([["chrome", "windows"], ["edge", "linux"], ["edge", "macos"]])(
    "suppresses unsupported %s/%s devices without degrading the Edge channel", async (browser, platform) => {
      Object.assign(rows.web_push_subscriptions, { browser_family: browser, platform_family: platform });
      await run();
      expect(mock.send).not.toHaveBeenCalled();
      expect(rows.notification_deliveries).toMatchObject({ status: "suppressed", error_code: "BROWSER_NOT_SUPPORTED" });
      expect(rows.integration_channels.status).toBe("enabled");
    },
  );

  it("does not send to FCM even when device metadata claims Windows Edge", async () => {
    const fcm = { ...browserSubscription, endpoint: "https://fcm.googleapis.com/device/test-only-capability" };
    rows.web_push_subscriptions.encrypted_payload = encryptWebPushSubscription(fcm, key);
    rows.web_push_subscriptions.endpoint_fingerprint = fingerprintWebPushEndpoint(fcm.endpoint, fingerprintSecret);
    await run();
    expect(mock.send).not.toHaveBeenCalled();
    expect(rows.notification_deliveries.error_code).toBe("WEB_PUSH_ORIGIN_NOT_ALLOWED");
  });

  it.each(["revoked", "expired", "ineligible", "channel_off", "archived", "already_sent"])(
    "does not send when %s", async (condition) => {
      if (condition === "revoked") rows.web_push_subscriptions.status = "revoked";
      if (condition === "expired") rows.notification_deliveries.expires_at = new Date(0).toISOString();
      if (condition === "ineligible") eligible = false;
      if (condition === "channel_off") enabled = false;
      if (condition === "archived") rows.notifications.archived_at = new Date().toISOString();
      if (condition === "already_sent") rows.notification_deliveries.status = "sent";
      await run();
      expect(mock.send).not.toHaveBeenCalled();
      if (condition === "ineligible") {
        expect(rows.web_push_subscriptions).toMatchObject({ status: "revoked", encrypted_payload: null });
      }
    },
  );

  it.each([400, 401, 403, 404, 410, 413, 429, 500, 503])("handles HTTP %i", async (statusCode) => {
    mock.send.mockRejectedValue({ statusCode, headers: { "retry-after": "90" }, body: browserSubscription.endpoint });
    await run();
    if ([404, 410].includes(statusCode)) {
      expect(rows.web_push_subscriptions).toMatchObject({ status: "gone", encrypted_payload: null });
      expect(rows.notification_deliveries.status).toBe("suppressed");
    } else if ([400, 401, 403, 413].includes(statusCode)) {
      expect(rows.notification_deliveries.status).toBe("failed");
      if ([401, 403].includes(statusCode)) expect(rows.integration_channels.status).toBe("degraded");
    } else {
      expect(rows.notification_deliveries.status).toBe("queued");
      const failure = rpc.mock.calls.find(([name]) => name === "fail_web_push_job");
      expect(failure?.[1]).toMatchObject({ p_retryable: true, p_retry_after_seconds: statusCode === 429 ? 90 : null });
    }
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(browserSubscription.endpoint);
  });

  it.each(["ENOTFOUND", "CERT_HAS_EXPIRED", "ETIMEDOUT"])("retries %s without leaking provider data", async (code) => {
    mock.send.mockRejectedValue(Object.assign(new Error(browserSubscription.endpoint), { code }));
    await run();
    const failure = rpc.mock.calls.find(([name]) => name === "fail_web_push_job");
    expect(failure?.[1]).toMatchObject({ p_retryable: true, p_error_code: "PUSH_NETWORK_FAILURE" });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(browserSubscription.endpoint);
  });

  it("records the delivery as dead when the final retry fails", async () => {
    failStatus = "dead";
    mock.send.mockRejectedValue({ statusCode: 503 });
    await run();
    expect(rows.notification_deliveries.status).toBe("dead");
  });
});
