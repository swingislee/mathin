import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSupportedWebPushDevice, isSupportedWebPushUserAgent } from "../src/features/events/web-push-contract";
import { validateWebPushEndpoint } from "../src/features/events/web-push-runtime.mjs";
import { registerMyWebPushSubscriptionAction } from "../src/features/events/web-push-actions";

const mock = vi.hoisted(() => ({ headers: new Map<string, string>(), rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => mock.headers }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mock.getUser }, rpc: mock.rpc }),
}));
const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0";
const origin = "https://wns2-sg2p.notify.windows.com";
const input = {
  browserFamily: "edge", platformFamily: "windows", deviceMode: "shared" as const,
  deviceLabel: "Test-only device", locale: "zh" as const,
  subscription: { endpoint: origin + "/w/?token=test-only-capability", expirationTime: null,
    keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } },
};

beforeEach(() => {
  mock.headers = new Map([["origin", "https://mathin.example.test"], ["host", "mathin.example.test"], ["user-agent", edge]]);
  mock.rpc.mockReset().mockResolvedValue({ data: "00000000-0000-4000-8000-000000000001", error: null });
  mock.getUser.mockReset().mockResolvedValue({ data: { user: { id: "test-only-user" } } });
  vi.stubEnv("MATHIN_WEB_PUSH_ALLOWED_ORIGINS", origin);
  vi.stubEnv("MATHIN_WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("MATHIN_WEB_PUSH_FINGERPRINT_SECRET", "test-only-fingerprint-secret-with-enough-length");
});
afterEach(() => vi.unstubAllEnvs());

describe("Windows Edge employee push scope", () => {
  it("recognizes desktop Edge before its embedded Chrome user-agent token", () => {
    expect(isSupportedWebPushUserAgent(edge)).toBe(true);
    expect(isSupportedWebPushDevice("edge", "windows")).toBe(true);
  });

  it.each([
    edge.replace(" Edg/152.0.0.0", ""),
    edge.replace("Windows NT 10.0; Win64; x64", "Macintosh; Intel Mac OS X 10_15_7"),
    edge.replace("Windows NT 10.0; Win64; x64", "X11; Linux x86_64"),
    "Mozilla/5.0 (Linux; Android 14) Chrome/152.0.0.0 EdgA/152.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/150.0",
    "",
  ])("keeps unsupported browsers outside the permission/registration path", (userAgent) => {
    expect(isSupportedWebPushUserAgent(userAgent)).toBe(false);
  });

  it.each([
    "https://fcm.googleapis.com/w/?token=test-only",
    "https://push.example.test/w/?token=test-only",
    "https://wns2-sg2p.notify.windows.com.example.test/w/?token=test-only",
    "https://notify.windows.com@evil.example.test/w/?token=test-only",
    "https://wns2-sg2p.notify.windows.com:8443/w/?token=test-only",
  ])("rejects non-WNS or nonstandard endpoints", (endpoint) => {
    expect(() => validateWebPushEndpoint(endpoint, origin)).toThrow();
  });

  it("keeps the exact WNS origin allowlist as an additional gate", () => {
    expect(validateWebPushEndpoint(input.subscription.endpoint, origin)).toBe(input.subscription.endpoint);
    expect(() => validateWebPushEndpoint(input.subscription.endpoint, "https://fcm.googleapis.com"))
      .toThrow("WEB_PUSH_ALLOWED_ORIGIN_INVALID");
    expect(() => validateWebPushEndpoint(input.subscription.endpoint, "https://wns2-am3p.notify.windows.com"))
      .toThrow("WEB_PUSH_ORIGIN_NOT_ALLOWED");
  });

  it("registers supported Edge through the existing authenticated encrypted RPC", async () => {
    expect(await registerMyWebPushSubscriptionAction(input)).toMatchObject({ ok: true });
    expect(mock.getUser).toHaveBeenCalledOnce();
    expect(mock.rpc).toHaveBeenCalledWith("register_my_web_push_subscription", expect.objectContaining({
      p_browser_family: "edge", p_platform_family: "windows",
    }));
    expect(JSON.stringify(mock.rpc.mock.calls)).not.toContain(input.subscription.endpoint);
  });

  it("rejects a Chrome caller even if it submits Edge metadata", async () => {
    mock.headers.set("user-agent", edge.replace(" Edg/152.0.0.0", ""));
    expect(await registerMyWebPushSubscriptionAction(input)).toEqual({ ok: false, code: "WEB_PUSH_BROWSER_NOT_SUPPORTED" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("rejects unsupported metadata even if the caller has an Edge user agent", async () => {
    expect(await registerMyWebPushSubscriptionAction({ ...input, browserFamily: "chrome" }))
      .toEqual({ ok: false, code: "WEB_PUSH_BROWSER_NOT_SUPPORTED" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("continues to reject cross-origin registration", async () => {
    mock.headers.set("origin", "https://other.example.test");
    expect(await registerMyWebPushSubscriptionAction(input)).toEqual({ ok: false, code: "CSRF_ORIGIN" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
