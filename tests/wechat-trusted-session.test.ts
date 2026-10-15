import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({
  token: "", getClaims: vi.fn(), getUser: vi.fn(), set: vi.fn(),
  config: null as null | { clientSecret: string; siteOrigin: string; authCallbackUrl: string },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => h.token ? { value: h.token } : undefined, set: h.set }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: h.getClaims, getUser: h.getUser } }) }));
vi.mock("@/features/wechat/config", () => ({
  getWechatConfig: () => h.config, requireWechatConfig: () => { if (!h.config) throw new Error("unavailable"); return h.config; },
}));
import { hasTrustedWechatSession, rememberWechatSession } from "@/features/wechat/trusted-session";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const subject = "mathin:fixture-union";
const user = { id: userId, identities: [{ provider: "custom:wechat", identity_data: { sub: subject } }] };
beforeEach(() => {
  vi.clearAllMocks(); h.token = "";
  h.config = { clientSecret: "fixture-signing-secret-".repeat(3), siteOrigin: "https://app.example.test", authCallbackUrl: "https://auth.example.test/auth/v1/callback" };
  h.getClaims.mockResolvedValue({ data: { claims: { sub: userId, session_id: sessionId, aal: "aal1" } }, error: null });
  h.getUser.mockResolvedValue({ data: { user }, error: null });
  h.set.mockImplementation((_name: string, token: string) => { h.token = token; });
});

describe("verified WeChat session proof", () => {
  it("keeps the native session across access-token refresh and uses a protected host cookie", async () => {
    await rememberWechatSession(userId, subject);
    expect(h.set).toHaveBeenCalledWith("__Host-mathin_wechat_session", expect.any(String), {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60,
    });
    expect(Buffer.from(h.token.split(".")[0], "base64url").toString()).not.toContain(subject);
    expect(await hasTrustedWechatSession(userId)).toBe(true);
    expect(await hasTrustedWechatSession(userId)).toBe(true);
  });

  it.each(["missing", "different-user", "different-session"])("cannot reuse a proof for %s", async (kind) => {
    await rememberWechatSession(userId, subject);
    const actor = kind === "different-user" ? sessionId : userId;
    const session = kind === "missing" ? undefined : kind === "different-session" ? userId : sessionId;
    h.getClaims.mockResolvedValue({ data: { claims: { sub: userId, session_id: session } }, error: null });
    expect(await hasTrustedWechatSession(actor)).toBe(false);
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it.each(["none", "malformed", "payload", "signature"])("rejects a %s proof", async (kind) => {
    await rememberWechatSession(userId, subject);
    const [payload, signature] = h.token.split(".");
    if (kind === "none") h.token = "";
    if (kind === "malformed") h.token = "not-a-signed-cookie";
    if (kind === "payload") h.token = `${Buffer.from(JSON.stringify({ userId, sessionId })).toString("base64url")}.${signature}`;
    if (kind === "signature") h.token = `${payload}.${"x".repeat(43)}`;
    expect(await hasTrustedWechatSession(userId)).toBe(false);
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it.each(["clientSecret", "siteOrigin", "authCallbackUrl"] as const)("does not cross a changed %s", async (field) => {
    await rememberWechatSession(userId, subject);
    h.config![field] += "-changed";
    expect(await hasTrustedWechatSession(userId)).toBe(false);
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("expires and stops applying when WeChat login is disabled", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    try {
      await rememberWechatSession(userId, subject);
      clock.mockReturnValue(1_800_000_000_000 + 30 * 24 * 60 * 60 * 1000);
      expect(await hasTrustedWechatSession(userId)).toBe(false);
      clock.mockReturnValue(1_800_000_000_000);
      h.config = null;
      expect(await hasTrustedWechatSession(userId)).toBe(false);
    } finally { clock.mockRestore(); }
  });

  it.each(["unlinked", "replaced", "other-provider", "other-user", "unavailable"])("checks authoritative identity after %s", async (kind) => {
    await rememberWechatSession(userId, subject);
    const changed = { ...user, identities: [...user.identities] };
    if (kind === "unlinked") changed.identities = [];
    if (kind === "replaced") changed.identities = [{ provider: "custom:wechat", identity_data: { sub: "mathin:other-union" } }];
    if (kind === "other-provider") changed.identities = [{ provider: "other", identity_data: { sub: subject } }];
    if (kind === "other-user") changed.id = sessionId;
    h.getUser.mockResolvedValue({ data: { user: changed }, error: kind === "unavailable" ? new Error("offline") : null });
    expect(await hasTrustedWechatSession(userId)).toBe(false);
  });

  it.each(["claims-error", "other-user", "missing-session"])("never signs a proof for %s", async (kind) => {
    h.getClaims.mockResolvedValue({ data: { claims: { sub: kind === "other-user" ? sessionId : userId, session_id: kind === "missing-session" ? undefined : sessionId } }, error: kind === "claims-error" ? new Error("invalid") : null });
    await expect(rememberWechatSession(userId, subject)).rejects.toThrow();
    expect(h.set).not.toHaveBeenCalled();
  });
});
