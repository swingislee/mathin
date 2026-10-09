import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ config: true, authorize: vi.fn(), active: vi.fn(), limit: vi.fn(),
  exchange: vi.fn(), native: vi.fn(), context: vi.fn(), password: vi.fn(), revoke: vi.fn(), owner: vi.fn(), conflict: vi.fn(),
  onboarding: vi.fn(), needsFamily: vi.fn(), resume: vi.fn() }));
vi.mock("@/features/parent-portal/onboarding-server", () => ({
  familyOnboardingAvailable: () => process.env.WECHAT_FAMILY_ONBOARDING_ENABLED === "true",
  beginFamilyOnboarding: (...args: unknown[]) => h.onboarding(...args),
  needsFamilyOnboarding: (...args: unknown[]) => h.needsFamily(...args),
  resumePendingFamily: (...args: unknown[]) => h.resume(...args),
}));
vi.mock("@/features/wechat/miniapp-config", () => ({ getMiniappWechatConfig: () => h.config ? { phoneLinking: true } : null }));
vi.mock("@/features/wechat/miniapp-provider", async (original) => ({ ...await original<object>(), exchangeMiniappWechatCode: (...args: unknown[]) => h.exchange(...args) }));
vi.mock("@/features/wechat/miniapp-session", () => ({ assertMiniappWechatAccount: (...args: unknown[]) => h.active(...args),
  exchangeMiniappIdentitySession: (...args: unknown[]) => h.native(...args), limitMiniappWechat: (...args: unknown[]) => h.limit(...args),
  miniappSessionContext: (...args: unknown[]) => h.context(...args), verifyMiniappWechatPassword: (...args: unknown[]) => h.password(...args),
  revokeMiniappSession: (...args: unknown[]) => h.revoke(...args) }));
vi.mock("@/features/wechat/store", () => ({ findWechatUser: (...args: unknown[]) => h.owner(...args), recordWechatConflict: (...args: unknown[]) => h.conflict(...args) }));
vi.mock("@/features/parent-portal/server", async (original) => ({ ...await original<object>(), authorize: (...args: unknown[]) => h.authorize(...args) }));
import { GET, POST } from "@/app/api/v1/parent/auth/wechat/route";
import { MiniappWechatError } from "@/features/wechat/miniapp-provider";
import { PortalError } from "@/features/parent-portal/server";

const userId = "11111111-1111-4111-8111-111111111111";
const user = { id: userId, email: "parent@example.test", identities: [] as { provider: string; identity_data: { sub: string } }[] };
const sessionId = "22222222-2222-4222-8222-222222222222";
const identity = { subject: "mathin:union-user", openid: "mini-open", unionid: "union-user", nickname: "", avatarUrl: null };
const session = { access_token: "issued-access", refresh_token: "issued-refresh", expires_at: 1_900_000_000 };
const baseUrl = "http://localhost/api/v1/parent/auth/wechat";
const body = (value: unknown, authenticated = false) => new Request(baseUrl, { method: "POST",
  headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer original-access" } : {}) }, body: JSON.stringify(value) });
const bind = { action: "bind", code: "fresh-code", password: "unit-password", confirm: true };
beforeEach(() => {
  for (const value of Object.values(h)) if (typeof value === "function" && "mockReset" in value) value.mockReset();
  h.config = true;
  vi.stubEnv("WECHAT_FAMILY_ONBOARDING_ENABLED", "false");
  h.needsFamily.mockResolvedValue(false); h.resume.mockResolvedValue(null);
  h.onboarding.mockResolvedValue({ state: "onboarding_required", ticket: "family-proof" });
  h.authorize.mockResolvedValue({ user: { ...user, identities: [] }, token: "original-access" });
  h.context.mockResolvedValue({ user: { ...user, identities: [] }, sessionId, mfaRequired: false });
  h.exchange.mockResolvedValue(identity); h.native.mockResolvedValue(session); h.owner.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("parent mini program auth HTTP", () => {
  it("reports configuration closure without trying Auth or WeChat", async () => {
    h.config = false;
    const status = await GET(new Request(baseUrl));
    expect(await status.json()).toEqual({ available: false, linked: null, canBind: false });
    const result = await POST(body({ action: "login", code: "fresh-code" }));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ code: "UNAVAILABLE", reason: "WECHAT_NOT_CONFIGURED" });
    expect(h.exchange).not.toHaveBeenCalled(); expect(h.limit).not.toHaveBeenCalled(); expect(h.native).not.toHaveBeenCalled();
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  });
  it("gets the signed-in user's actual binding state even while configuration is closed", async () => {
    h.config = false;
    h.authorize.mockResolvedValue({ user: { ...user, identities: [{ provider: "custom:wechat", identity_data: { sub: identity.subject } }] }, token: "original-access" });
    expect(await (await GET(new Request(baseUrl, { headers: { authorization: "Bearer original-access" } }))).json())
      .toEqual({ available: false, linked: true, canBind: false });
  });
  it("does not treat a submitted Bearer as anonymous on verification failure", async () => {
    h.authorize.mockRejectedValue(new PortalError("UNAUTHENTICATED"));
    expect((await GET(new Request(baseUrl, { headers: { authorization: "Bearer invalid" } }))).status).toBe(401);
  });
  it("checks available binding capabilities and MFA", async () => {
    const request = new Request(baseUrl, { headers: { authorization: "Bearer original-access" } });
    expect(await (await GET(request)).json()).toEqual({ available: true, linked: false, canBind: true });
    h.context.mockResolvedValue({ user, sessionId, mfaRequired: true });
    expect((await (await GET(request)).json()).canBind).toBe(false);
  });
  it("gives an unknown genuine identity a binding step with no session or profile", async () => {
    const result = await POST(body({ action: "login", code: "fresh-code" }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ state: "binding_required" });
    expect(h.native).not.toHaveBeenCalled(); expect(h.authorize).not.toHaveBeenCalled();
    expect(h.limit).toHaveBeenCalledWith(expect.any(Request), "login");
  });
  it("returns the existing account's normal session only after portal and MFA checks", async () => {
    h.owner.mockResolvedValue(userId);
    const result = await POST(body({ action: "login", code: "fresh-code" }));
    expect(await result.json()).toEqual({ state: "authenticated", session: { accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: session.expires_at } });
    expect(h.native).toHaveBeenCalledWith(expect.any(Object), identity, userId);
    expect(h.revoke).not.toHaveBeenCalled();
  });
  it("offers a linked work account its own family registration after security checks", async () => {
    vi.stubEnv("WECHAT_FAMILY_ONBOARDING_ENABLED", "true");
    h.owner.mockResolvedValue(userId); h.needsFamily.mockResolvedValue(true);
    const result = await POST(body({ action: "login", code: "fresh-code", location: { status: "declined" } }));
    expect(await result.json()).toEqual({ state: "onboarding_required", ticket: "family-proof" });
    expect(h.onboarding).toHaveBeenCalledWith(identity, null, { status: "declined" });
    expect(h.revoke).toHaveBeenCalledWith(session.access_token);
  });
  it("does not force already associated work accounts to register again", async () => {
    vi.stubEnv("WECHAT_FAMILY_ONBOARDING_ENABLED", "true"); h.owner.mockResolvedValue(userId);
    expect(await (await POST(body({ action: "login", code: "fresh-code" }))).json()).toMatchObject({ state: "authenticated" });
    expect(h.onboarding).not.toHaveBeenCalled(); expect(h.revoke).not.toHaveBeenCalled();
  });
  it("does not offer family registration around an existing account's MFA requirement", async () => {
    vi.stubEnv("WECHAT_FAMILY_ONBOARDING_ENABLED", "true"); h.owner.mockResolvedValue(userId);
    h.needsFamily.mockResolvedValue(true); h.context.mockResolvedValue({ user, sessionId, mfaRequired: true });
    expect((await POST(body({ action: "login", code: "fresh-code" }))).status).toBe(403);
    expect(h.onboarding).not.toHaveBeenCalled(); expect(h.needsFamily).not.toHaveBeenCalled();
  });
  it.each(["FORBIDDEN", "ACCOUNT_SECURITY"] as const)("revokes a newly issued session that fails %s", async (code) => {
    h.owner.mockResolvedValue(userId); h.authorize.mockRejectedValue(new PortalError(code));
    const result = await POST(body({ action: "login", code: "fresh-code" }));
    expect(result.status).toBe(403); expect(await result.json()).toEqual({ code });
    expect(h.revoke).toHaveBeenCalledWith(session.access_token);
  });
  it("does not issue a usable AAL1 login for an account requiring AAL2", async () => {
    h.owner.mockResolvedValue(userId); h.context.mockResolvedValue({ user, sessionId, mfaRequired: true });
    const result = await POST(body({ action: "login", code: "fresh-code" }));
    expect(await result.json()).toEqual({ code: "ACCOUNT_SECURITY", reason: "WECHAT_MFA_REQUIRED" });
    expect(h.revoke).toHaveBeenCalledWith(session.access_token);
  });
  it("requires explicit consent, rejects caller-supplied identities and bounds the body", async () => {
    for (const value of [{ ...bind, confirm: false }, { ...bind, userId }, { action: "login", code: "fresh-code", unionid: "caller-identity" }]) {
      expect((await POST(body(value, true))).status).toBe(400);
    }
    expect((await POST(body({ action: "login", code: "x".repeat(40_000) }))).status).toBe(413);
    expect(h.exchange).not.toHaveBeenCalled();
  });
  it("rejects missing sessions, wrong original passwords and insufficient MFA before code exchange", async () => {
    h.authorize.mockRejectedValueOnce(new PortalError("UNAUTHENTICATED"));
    expect((await POST(body(bind))).status).toBe(401);
    h.password.mockRejectedValueOnce(new MiniappWechatError("UNAUTHENTICATED", "WECHAT_CREDENTIALS_INVALID"));
    expect(await (await POST(body(bind, true))).json()).toEqual({ code: "UNAUTHENTICATED", reason: "WECHAT_CREDENTIALS_INVALID" });
    h.context.mockResolvedValue({ user, sessionId, mfaRequired: true });
    expect((await POST(body(bind, true))).status).toBe(403);
    expect(h.exchange).not.toHaveBeenCalled();
  });
  it("returns bound after native linking and keeps the original session", async () => {
    const result = await POST(body(bind, true));
    expect(await result.json()).toEqual({ state: "bound" });
    expect(h.password).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ id: userId }), bind.password);
    expect(h.native).toHaveBeenCalledWith(expect.any(Object), identity, userId, expect.objectContaining({ token: "original-access", sessionId, verify: expect.any(Function) }));
    expect(h.revoke).toHaveBeenCalledWith(session.access_token, sessionId);
    expect(h.limit).toHaveBeenCalledWith(expect.any(Request), "bind", userId);
  });
  it("handles a retry of an already completed binding without another link mutation", async () => {
    h.owner.mockResolvedValue(userId);
    h.context.mockResolvedValue({ user: { ...user, identities: [{ provider: "custom:wechat", identity_data: { sub: identity.subject } }] }, sessionId, mfaRequired: false });
    expect(await (await POST(body(bind, true))).json()).toEqual({ state: "bound" });
    expect(h.native).not.toHaveBeenCalled(); expect(h.password).toHaveBeenCalled();
  });
  it.each(["other-owner", "other-identity"])("rejects and audits %s without disclosing the other account", async (mode) => {
    if (mode === "other-owner") h.owner.mockResolvedValue("33333333-3333-4333-8333-333333333333");
    else h.context.mockResolvedValue({ user: { ...user, identities: [{ provider: "custom:wechat", identity_data: { sub: "mathin:another" } }] }, sessionId, mfaRequired: false });
    const result = await POST(body(bind, true));
    expect(result.status).toBe(409); expect(await result.json()).toEqual({ code: "CONFLICT" });
    expect(h.conflict).toHaveBeenCalledWith(userId, identity.subject); expect(h.native).not.toHaveBeenCalled();
  });
  it("rejects a changed session before releasing a native grant", async () => {
    h.context.mockResolvedValueOnce({ user, sessionId, mfaRequired: false }).mockResolvedValue({ user, sessionId: "changed", mfaRequired: false });
    const result = await POST(body(bind, true));
    expect(result.status).toBe(401); expect(h.native).not.toHaveBeenCalled();
  });
  it("maps UnionID, limit and raw failures to fixed responses", async () => {
    h.exchange.mockRejectedValueOnce(new MiniappWechatError("UNAVAILABLE", "WECHAT_UNIONID_REQUIRED"));
    expect(await (await POST(body({ action: "login", code: "fresh-code" }))).json()).toEqual({ code: "UNAVAILABLE", reason: "WECHAT_UNIONID_REQUIRED" });
    h.limit.mockRejectedValueOnce(new MiniappWechatError("RATE_LIMIT"));
    expect((await POST(body({ action: "login", code: "fresh-code" }))).status).toBe(429);
    h.exchange.mockRejectedValueOnce(new Error("private identity and credentials URL"));
    expect(await (await POST(body({ action: "login", code: "fresh-code" }))).json()).toEqual({ code: "UNAVAILABLE" });
  });
});
