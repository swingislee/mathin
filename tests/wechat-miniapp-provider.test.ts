import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getMiniappWechatConfig } from "@/features/wechat/miniapp-config";
import { exchangeMiniappWechatCode, MiniappWechatError } from "@/features/wechat/miniapp-provider";
import { wechatClaims } from "@/features/wechat/provider";

const appId = "wx" + "0".repeat(16);
const config = { appId, appSecret: "unit-test-only", namespace: "mathin", clientId: "mathin-wechat",
  clientSecret: "unit-test-only-".repeat(3), siteOrigin: "https://app.example.test",
  authOrigin: "https://auth.example.test", authCallbackUrl: "https://auth.example.test/auth/v1/callback",
  completionUrl: "https://app.example.test/api/v1/parent/auth/wechat", phoneLinking: true };

function configure() {
  vi.stubEnv("WECHAT_MINIPROGRAM_ENABLED", "true");
  vi.stubEnv("WECHAT_AUTH_COMPATIBILITY_VERIFIED", "true");
  vi.stubEnv("WECHAT_MINIPROGRAM_APP_ID", appId);
  vi.stubEnv("WECHAT_MINIPROGRAM_APP_SECRET", config.appSecret);
  vi.stubEnv("WECHAT_OPEN_PLATFORM_NAMESPACE", config.namespace);
  vi.stubEnv("WECHAT_BROKER_CLIENT_SECRET", config.clientSecret);
  vi.stubEnv("WECHAT_SITE_ORIGIN", config.siteOrigin);
  vi.stubEnv("WECHAT_SUPABASE_PUBLIC_ORIGIN", config.authOrigin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", config.authOrigin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "unit-test-public-key");
  vi.stubEnv("SUPABASE_SECRET_KEY", "unit-test-secret-key");
  vi.stubEnv("WECHAT_PHONE_LINKING_VERIFIED", "true");
}
beforeEach(configure);
afterEach(() => vi.unstubAllEnvs());

describe("mini program configuration", () => {
  it("uses separate mini program credentials without enabling website OAuth", () => {
    vi.stubEnv("WECHAT_OAUTH_ENABLED", "false");
    vi.stubEnv("WECHAT_WEB_APP_ID", "website-fixture");
    vi.stubEnv("WECHAT_WEB_APP_SECRET", "website-fixture");
    expect(getMiniappWechatConfig()).toEqual(config);
  });
  it.each(["WECHAT_MINIPROGRAM_APP_ID", "WECHAT_MINIPROGRAM_APP_SECRET", "WECHAT_OPEN_PLATFORM_NAMESPACE",
    "WECHAT_BROKER_CLIENT_SECRET", "WECHAT_SITE_ORIGIN", "WECHAT_SUPABASE_PUBLIC_ORIGIN", "SUPABASE_SECRET_KEY"]) ("closes when %s is missing", (key) => {
    vi.stubEnv(key, "");
    expect(getMiniappWechatConfig()).toBeNull();
  });
  it.each(["WECHAT_MINIPROGRAM_ENABLED", "WECHAT_AUTH_COMPATIBILITY_VERIFIED"])("requires %s", (key) => {
    vi.stubEnv(key, "false");
    expect(getMiniappWechatConfig()).toBeNull();
  });
  it("rejects another Auth environment and non-origin URLs", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://other.example.test");
    expect(getMiniappWechatConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", config.authOrigin);
    vi.stubEnv("WECHAT_SITE_ORIGIN", config.siteOrigin + "/path");
    expect(getMiniappWechatConfig()).toBeNull();
  });
  it("permits the registered LAN development origin and closes HTTP in production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WECHAT_SITE_ORIGIN", "http://192.168.5.213:3130");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:35421");
    vi.stubEnv("WECHAT_SUPABASE_PUBLIC_ORIGIN", "http://127.0.0.1:35421");
    expect(getMiniappWechatConfig()?.authOrigin).toBe("http://127.0.0.1:35421");
    vi.stubEnv("NODE_ENV", "production");
    expect(getMiniappWechatConfig()).toBeNull();
  });
});

describe("wx.login server exchange", () => {
  it("calls only code2Session with mini program credentials and discards the session key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ openid: "mini-open", unionid: "union-user", session_key: "unit-session-key" }));
    const identity = await exchangeMiniappWechatCode(config, "fresh-code", fetcher);
    const [raw, options] = fetcher.mock.calls[0];
    const url = new URL(String(raw));
    expect(url.origin + url.pathname).toBe("https://api.weixin.qq.com/sns/jscode2session");
    expect(Object.fromEntries(url.searchParams)).toEqual({ appid: appId, secret: config.appSecret, js_code: "fresh-code", grant_type: "authorization_code" });
    expect(options).toMatchObject({ cache: "no-store", redirect: "error" });
    expect(identity).toMatchObject({ subject: "mathin:union-user", openid: "mini-open", unionid: "union-user", nickname: "", avatarUrl: null });
    expect(JSON.stringify(identity)).not.toContain("session_key");
    expect(wechatClaims(identity)).toEqual({ sub: "mathin:union-user" });
  });
  it("requires the real cross-application UnionID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ openid: "mini-open", session_key: "unit-session-key" }));
    await expect(exchangeMiniappWechatCode(config, "fresh-code", fetcher)).rejects.toMatchObject({ code: "UNAVAILABLE", reason: "WECHAT_UNIONID_REQUIRED" });
  });
  it.each([40029, 40163])("rejects expired or already used code %s", async (errcode) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ errcode, errmsg: "upstream detail" }));
    await expect(exchangeMiniappWechatCode(config, "fresh-code", fetcher)).rejects.toMatchObject({ code: "UNAUTHENTICATED", reason: "WECHAT_CODE_INVALID" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("maps upstream frequency limits without its raw message", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ errcode: 45011, errmsg: "private upstream detail" }));
    await expect(exchangeMiniappWechatCode(config, "fresh-code", fetcher)).rejects.toMatchObject({ code: "RATE_LIMIT", message: "RATE_LIMIT" });
  });
  it.each(["", "x".repeat(257), "code?secret=x"])("rejects invalid input before network", async (code) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(exchangeMiniappWechatCode(config, code, fetcher)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("masks network URLs, malformed replies and oversized responses", async () => {
    const replies = [new Error("private URL and credentials"), new Response("not-json"), new Response("x".repeat(16_385)), Response.json({ errcode: 40125, errmsg: "secret invalid" }), Response.json({ openid: "only-open" })];
    for (const reply of replies) {
      const fetcher = vi.fn<typeof fetch>();
      if (reply instanceof Error) fetcher.mockRejectedValue(reply); else fetcher.mockResolvedValue(reply);
      const error = await exchangeMiniappWechatCode(config, "fresh-code", fetcher).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(MiniappWechatError);
      expect(String(error)).toBe("Error: UNAVAILABLE");
    }
  });
});
