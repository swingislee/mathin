import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { exchangeWechatCode, verifyPkce, wechatAuthorizationUrl, wechatClaims } from "@/features/wechat/provider";
import { safeWechatAvatar } from "@/features/wechat/contract";
import { getWechatConfig, type WechatConfig } from "@/features/wechat/config";

const config: WechatConfig = {
  appId: "touristappid", appSecret: "not-a-secret", namespace: "mathin", clientId: "mathin-wechat",
  clientSecret: "not-a-secret", siteOrigin: "https://app.example.com", callbackUrl: "https://app.example.com/zh/auth/wechat/callback",
  authCallbackUrl: "https://auth.example.com/auth/v1/callback", phoneLinking: false,
};
function provider(token = {}, info = {}) {
  return vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: "test-only-capability", openid: "website-user", scope: "snsapi_login", unionid: "union-user", ...token }))
    .mockResolvedValueOnce(Response.json({ openid: "website-user", unionid: "union-user", nickname: " Test ", headimgurl: "https://thirdwx.qlogo.cn/avatar/0", ...info }));
}
afterEach(() => vi.unstubAllEnvs());

describe("WeChat website protocol", () => {
  it("uses the website scope and encoded canonical callback with random state", () => {
    const url = new URL(wechatAuthorizationUrl(config, "a".repeat(64), "en"));
    expect(url.origin).toBe("https://open.weixin.qq.com");
    expect(url.pathname).toBe("/connect/qrconnect");
    expect(url.searchParams.get("redirect_uri")).toBe(config.callbackUrl);
    expect(url.searchParams.get("scope")).toBe("snsapi_login");
    expect(url.searchParams.get("state")).toBe("a".repeat(64));
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.toString()).not.toContain(config.appSecret);
  });

  it("checks both responses and keeps only minimal profile fields with a stable subject", async () => {
    const fetcher = provider({}, { sex: 1, province: "unused", phone: "+8613800000000", email: "ignored@example.com" });
    const identity = await exchangeWechatCode(config, "valid-code", fetcher);
    expect(identity).toEqual(expect.objectContaining({ subject: "mathin:union-user", openid: "website-user", unionid: "union-user", nickname: "Test" }));
    expect(identity).not.toHaveProperty("phone");
    expect(identity).not.toHaveProperty("sex");
    expect(identity).not.toHaveProperty("access_token");
    expect(wechatClaims(identity)).toEqual({ sub: "mathin:union-user", name: "Test", preferred_username: "Test", picture: "https://thirdwx.qlogo.cn/avatar/0" });
    const first = new URL(String(fetcher.mock.calls[0][0]));
    expect(first.searchParams.get("appid")).toBe(config.appId);
    expect(first.searchParams.get("secret")).toBe(config.appSecret);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error" });
  });

  it.each([
    [{}, { unionid: undefined }], [{}, { openid: "someone-else" }],
    [{ unionid: "another-user" }, {}], [{ scope: "snsapi_base" }, {}],
  ])("rejects missing or mismatched identity proofs", async (token, info) => {
    await expect(exchangeWechatCode(config, "valid-code", provider(token, info))).rejects.toThrow("failed");
  });

  it("accepts UnionID from userinfo when the token response omitted it", async () => {
    const identity = await exchangeWechatCode(config, "valid-code", provider({ unionid: undefined }));
    expect(identity.subject).toBe("mathin:union-user");
  });

  it("never returns provider errors, credentials, or outgoing URLs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private request with secret"));
    await expect(exchangeWechatCode(config, "valid-code", fetcher)).rejects.toThrow(/^failed$/);
    await expect(exchangeWechatCode(config, "bad code", fetcher)).rejects.toThrow(/^expired$/);
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ errcode: 40029, errmsg: "private upstream message" }));
    await expect(exchangeWechatCode(config, "valid-code", upstream)).rejects.toThrow(/^failed$/);
  });

  it("rejects untrusted avatars and preserves only official HTTPS origins", () => {
    for (const url of ["https://thirdwx.qlogo.cn.evil.example/a", "https://localhost/a", "javascript:alert(1)", "https://user@wx.qlogo.cn/a", "https://wx.qlogo.cn:8443/a"]) {
      expect(safeWechatAvatar(url)).toBeNull();
    }
    expect(safeWechatAvatar("http://wx.qlogo.cn/avatar/0")).toBe("https://wx.qlogo.cn/avatar/0");
    expect(safeWechatAvatar("")).toBeNull();
  });

  it("requires S256 proof rather than accepting the challenge as a verifier", () => {
    const verifier = "v".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(challenge, challenge)).toBe(false);
    expect(verifyPkce("short", challenge)).toBe(false);
  });
});

describe("WeChat enablement", () => {
  it("fails closed until configuration and Auth compatibility are verified", () => {
    vi.stubEnv("WECHAT_OAUTH_ENABLED", "true");
    vi.stubEnv("WECHAT_AUTH_COMPATIBILITY_VERIFIED", "false");
    expect(getWechatConfig()).toBeNull();
    vi.stubEnv("WECHAT_WEB_APP_ID", "touristappid");
    vi.stubEnv("WECHAT_WEB_APP_SECRET", "not-a-secret");
    vi.stubEnv("WECHAT_BROKER_CLIENT_SECRET", "x".repeat(48));
    vi.stubEnv("WECHAT_OPEN_PLATFORM_NAMESPACE", "mathin");
    vi.stubEnv("WECHAT_SITE_ORIGIN", "https://app.example.com");
    vi.stubEnv("WECHAT_SUPABASE_PUBLIC_ORIGIN", "https://auth.example.com");
    vi.stubEnv("WECHAT_AUTH_COMPATIBILITY_VERIFIED", "true");
    vi.stubEnv("WECHAT_PHONE_LINKING_VERIFIED", "false");
    expect(getWechatConfig()).toMatchObject({ callbackUrl: "https://app.example.com/zh/auth/wechat/callback", phoneLinking: false });
    vi.stubEnv("WECHAT_SITE_ORIGIN", "http://192.168.5.213:3130");
    expect(getWechatConfig()).toBeNull();
  });
});
