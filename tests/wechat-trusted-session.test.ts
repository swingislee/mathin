import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({
  token: "", stored: null as string | null, getClaims: vi.fn(), getUser: vi.fn(), set: vi.fn(),
  rpc: vi.fn(), upsert: vi.fn(), from: vi.fn(),
  config: null as null | { clientSecret: string; siteOrigin: string; authCallbackUrl: string },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => h.token ? { value: h.token } : undefined, set: h.set }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getClaims: h.getClaims, getUser: h.getUser }, rpc: h.rpc,
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock("@/features/wechat/config", () => ({
  getWechatConfig: () => h.config, requireWechatConfig: () => { if (!h.config) throw new Error("unavailable"); return h.config; },
}));
import { hasTrustedWechatSession, rememberWechatSession } from "@/features/wechat/trusted-session";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const identityId = "33333333-3333-4333-8333-333333333333";
const subject = "mathin:fixture-union";
const user = { id: userId, identities: [{ identity_id: identityId, provider: "custom:wechat", identity_data: { sub: subject } }] };
beforeEach(() => {
  vi.resetAllMocks(); h.token = ""; h.stored = null;
  h.config = { clientSecret: "fixture-signing-secret-".repeat(3), siteOrigin: "https://app.example.test", authCallbackUrl: "https://auth.example.test/auth/v1/callback" };
  h.getClaims.mockResolvedValue({ data: { claims: { sub: userId, session_id: sessionId, aal: "aal1" } }, error: null });
  h.getUser.mockResolvedValue({ data: { user }, error: null });
  h.set.mockImplementation((_name: string, token: string) => { h.token = token; });
  h.rpc.mockImplementation(async () => ({ data: h.stored, error: null }));
  h.from.mockReturnValue({ upsert: h.upsert });
  h.upsert.mockImplementation(async (row: { proof: string }) => {
    h.stored = row.proof; return { error: null };
  });
});

describe("verified WeChat session proof", () => {
  it("persists the verified native session and keeps the old protected cookie for rollback", async () => {
    await rememberWechatSession(userId, subject);
    expect(h.set).toHaveBeenCalledWith("__Host-mathin_wechat_session", expect.any(String), {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60,
    });
    expect(Buffer.from(h.token.split(".")[0], "base64url").toString()).not.toContain(subject);
    expect(h.from).toHaveBeenCalledWith("wechat_trusted_sessions");
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({
      session_id: sessionId, user_id: userId, identity_id: identityId, proof: h.token,
    }));
    expect(await hasTrustedWechatSession(userId)).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("current_wechat_session_proof");
  });

  it("restores the same session without the proof cookie, including after access-token refresh", async () => {
    await rememberWechatSession(userId, subject);
    h.token = "";
    h.getClaims.mockResolvedValue({ data: { claims: {
      sub: userId, session_id: sessionId, aal: "aal1", iat: 1_800_001_000,
    } }, error: null });
    expect(await hasTrustedWechatSession(userId)).toBe(true);
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "different-user", "different-session"])("cannot reuse a proof for %s", async (kind) => {
    await rememberWechatSession(userId, subject);
    h.getUser.mockClear();
    const actor = kind === "different-user" ? sessionId : userId;
    const session = kind === "missing" ? undefined : kind === "different-session" ? userId : sessionId;
    h.getClaims.mockResolvedValue({ data: { claims: { sub: userId, session_id: session } }, error: null });
    expect(await hasTrustedWechatSession(actor)).toBe(false);
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it.each(["none", "malformed", "payload", "signature"])("rejects a %s server proof", async (kind) => {
    await rememberWechatSession(userId, subject);
    h.getUser.mockClear();
    const [payload, signature] = h.token.split(".");
    h.token = "";
    if (kind === "none") h.stored = null;
    if (kind === "malformed") h.stored = "not-a-signed-cookie";
    if (kind === "payload") h.stored = `${Buffer.from(JSON.stringify({ userId, sessionId })).toString("base64url")}.${signature}`;
    if (kind === "signature") h.stored = `${payload}.${"x".repeat(43)}`;
    expect(await hasTrustedWechatSession(userId)).toBe(false);
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it.each(["clientSecret", "siteOrigin", "authCallbackUrl"] as const)("does not cross a changed %s", async (field) => {
    await rememberWechatSession(userId, subject);
    h.getUser.mockClear();
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
    if (kind === "replaced") changed.identities = [{ identity_id: identityId, provider: "custom:wechat", identity_data: { sub: "mathin:other-union" } }];
    if (kind === "other-provider") changed.identities = [{ identity_id: identityId, provider: "other", identity_data: { sub: subject } }];
    if (kind === "other-user") changed.id = sessionId;
    h.getUser.mockResolvedValue({ data: { user: changed }, error: kind === "unavailable" ? new Error("offline") : null });
    expect(await hasTrustedWechatSession(userId)).toBe(false);
  });

  it.each(["claims-error", "other-user", "missing-session"])("never signs a proof for %s", async (kind) => {
    h.getClaims.mockResolvedValue({ data: { claims: { sub: kind === "other-user" ? sessionId : userId, session_id: kind === "missing-session" ? undefined : sessionId } }, error: kind === "claims-error" ? new Error("invalid") : null });
    await expect(rememberWechatSession(userId, subject)).rejects.toThrow();
    expect(h.set).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("migrates a valid old cookie without extending its verification deadline", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    try {
      await rememberWechatSession(userId, subject);
      const original = h.upsert.mock.calls[0][0];
      h.stored = null; h.upsert.mockClear();
      clock.mockReturnValue(1_800_000_000_000 + 24 * 60 * 60 * 1000);
      expect(await hasTrustedWechatSession(userId)).toBe(true);
      expect(h.upsert).toHaveBeenCalledExactlyOnceWith(original);
      h.token = "";
      expect(await hasTrustedWechatSession(userId)).toBe(true);
    } finally { clock.mockRestore(); }
  });

  it("does not persist a tampered old cookie", async () => {
    await rememberWechatSession(userId, subject);
    h.stored = null; h.upsert.mockClear();
    h.token = `${h.token.split(".")[0]}.${"x".repeat(43)}`;
    expect(await hasTrustedWechatSession(userId)).toBe(false);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it.each(["wrong-user", "unlinked", "missing-identity-id"])("does not register a %s session", async (kind) => {
    h.getUser.mockResolvedValue({ data: { user: {
      ...user, id: kind === "wrong-user" ? sessionId : userId,
      identities: kind === "unlinked" ? [] : [{ ...user.identities[0], identity_id: kind === "missing-identity-id" ? "" : identityId }],
    } }, error: null });
    await expect(rememberWechatSession(userId, subject)).rejects.toThrow();
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
  });

  it("fails the new callback when persistence fails, before issuing a cookie", async () => {
    h.upsert.mockResolvedValue({ error: new Error("offline") });
    await expect(rememberWechatSession(userId, subject)).rejects.toThrow("unavailable");
    expect(h.set).not.toHaveBeenCalled();
  });

  it("keeps a valid old cookie usable during database migration without inventing trust", async () => {
    await rememberWechatSession(userId, subject);
    h.stored = null; h.upsert.mockClear();
    h.rpc.mockResolvedValue({ data: null, error: new Error("unavailable") });
    expect(await hasTrustedWechatSession(userId)).toBe(true);
    expect(h.upsert).not.toHaveBeenCalled();
    h.token = "";
    expect(await hasTrustedWechatSession(userId)).toBe(false);
  });
});
