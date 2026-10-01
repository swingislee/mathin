import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import type { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({
  config: {} as Record<string, unknown>, owner: null as string | null, user: {} as User, active: true,
  signOut: vi.fn(), conflict: vi.fn(), rpc: vi.fn(), serial: 0,
  tickets: new Map<string, { kind: string; binding: string; payload: object }>(),
}));
vi.mock("@/features/wechat/config", () => ({ requireWechatConfig: () => h.config }));
vi.mock("@/features/wechat/store", async (original) => ({ ...await original<object>(),
  findWechatUser: async () => h.owner,
  assertAccountActive: async () => { if (!h.active) throw new Error("failed"); },
  recordWechatConflict: (...args: unknown[]) => h.conflict(...args),
  issueTicket: async (kind: string, payload: object, binding: string, seconds: number) => {
    expect(seconds).toBe(60);
    expect(JSON.stringify(payload)).not.toContain("session_key");
    const token = (++h.serial).toString(16).padStart(64, "0");
    h.tickets.set(token, { kind, payload, binding });
    return token;
  },
  readTicket: async (kind: string, token: string, binding: string, schema: z.ZodType, consume: boolean) => {
    const ticket = h.tickets.get(token);
    if (!ticket || ticket.kind !== kind || ticket.binding !== binding) return null;
    if (consume) h.tickets.delete(token);
    return schema.parse(ticket.payload);
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: {
  getUserById: async () => ({ data: { user: h.user }, error: null }),
  signOut: (...args: unknown[]) => h.signOut(...args),
} }, rpc: (...args: unknown[]) => h.rpc(...args) }) }));
import { brokerUserInfo, exchangeBrokerToken } from "@/features/wechat/broker";
import { exchangeMiniappIdentitySession, limitMiniappWechat, miniappSessionContext,
  revokeMiniappSession, verifyMiniappWechatPassword } from "@/features/wechat/miniapp-session";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const issuedId = "44444444-4444-4444-8444-444444444444";
const config = { appId: "touristappid", appSecret: "unit-test-only", namespace: "mathin", clientId: "mathin-wechat",
  clientSecret: "unit-test-only-".repeat(3), siteOrigin: "https://app.example.test", authOrigin: "https://auth.example.test",
  authCallbackUrl: "https://auth.example.test/auth/v1/callback", completionUrl: "https://app.example.test/api/v1/parent/auth/wechat", phoneLinking: true };
const proof = { subject: "mathin:union-user", openid: "mini-open", unionid: "union-user", nickname: "", avatarUrl: null, authorizedAt: "2026-10-01T00:00:00.000Z" };
const nativeIdentity = { id: "identity-id", identity_id: "identity-id", user_id: userId, provider: "custom:wechat", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", identity_data: { sub: proof.subject, name: "Existing name", picture: "https://thirdwx.qlogo.cn/avatar/0" } };
const sha = (text: string) => createHash("sha256").update(text).digest("base64url");
function token(id = issuedId, aal = "aal1", sub = userId) {
  return [ { alg: "HS256", typ: "JWT" }, { sub, session_id: id, aal, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) } ]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".unit-signature";
}
function session(id = userId) {
  return { access_token: token(issuedId, "aal1", id), refresh_token: "unit-refresh", token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { ...h.user, id } };
}

type Mode = "ok" | "wrong-provider" | "wrong-correlation" | "wrong-completion" | "owner-changed" | "wrong-issued-user" | "wrong-password-user" | "bad-inner-pkce";
function protocol(mode: Mode = "ok", binding = false) {
  let challenge = "";
  const events: string[] = [];
  const nativeVerifier = "native-provider-verifier-".repeat(3);
  const authorizeUrl = (url: URL) => {
    challenge = url.searchParams.get("code_challenge") ?? "";
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
    expect(url.searchParams.get("redirect_to")).toBe(config.completionUrl);
    const destination = new URL("/zh/auth/wechat/authorize", mode === "wrong-provider" ? "https://other.example.test" : config.siteOrigin);
    destination.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.authCallbackUrl,
      response_type: "code", state: "native-state", code_challenge: sha(nativeVerifier), code_challenge_method: "S256",
      mathin_flow: mode === "wrong-correlation" ? "b".repeat(64) : url.searchParams.get("mathin_flow") ?? "" }).toString();
    if (mode === "owner-changed") h.owner = otherId;
    return destination.toString();
  };
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.origin).toBe(config.authOrigin);
    if (url.pathname === "/auth/v1/authorize") {
      events.push("authorize");
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: authorizeUrl(url) } });
    }
    if (url.pathname === "/auth/v1/user/identities/authorize") {
      events.push("link");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token(sessionId, "aal2")}`);
      return Response.json({ url: authorizeUrl(url) });
    }
    if (url.pathname === "/auth/v1/callback") {
      events.push("native-callback");
      expect(url.searchParams.get("state")).toBe("native-state");
      const code = url.searchParams.get("code")!;
      const grant = h.tickets.get(code)!;
      expect(grant.kind).toBe("grant");
      expect(grant.payload).toMatchObject({ flow: { mode: binding ? "link" : "login", userId: binding ? userId : null,
        sessionId: binding ? sessionId : null }, userId, identity: { subject: proof.subject } });
      const request = () => new Request(`${config.siteOrigin}/zh/auth/wechat/token`, { method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}` },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.authCallbackUrl,
          code_verifier: mode === "bad-inner-pkce" ? "incorrect-verifier-".repeat(3) : nativeVerifier }) });
      const exchanged = await exchangeBrokerToken(request());
      if (mode === "bad-inner-pkce") {
        expect(exchanged.status).toBe(400);
        return new Response(null, { status: 302, headers: { location: `${config.completionUrl}?error=access_denied` } });
      }
      expect(exchanged.status).toBe(200);
      const access = (await exchanged.json()).access_token;
      expect((await exchangeBrokerToken(request())).status).toBe(400);
      const infoRequest = () => new Request(`${config.siteOrigin}/zh/auth/wechat/userinfo`, { headers: { authorization: `Bearer ${access}` } });
      const info = await brokerUserInfo(infoRequest());
      expect(info.status).toBe(200);
      expect((await info.json()).sub).toBe(proof.subject);
      expect((await brokerUserInfo(infoRequest())).status).toBe(400);
      if (binding) { h.owner = userId; h.user.identities = [nativeIdentity]; }
      return new Response(null, { status: 302, headers: { location: `${mode === "wrong-completion" ? "https://other.example.test/result" : config.completionUrl}?code=native-auth-code` } });
    }
    if (url.pathname === "/auth/v1/token") {
      const body = JSON.parse(String(init?.body));
      if (url.searchParams.get("grant_type") === "password") {
        events.push("password");
        expect(body.password).toBe("unit-password");
        expect(body.email).toBe(h.user.email);
        return Response.json(session(mode === "wrong-password-user" ? otherId : userId));
      }
      events.push("session");
      expect(url.searchParams.get("grant_type")).toBe("pkce");
      expect(body.auth_code).toBe("native-auth-code");
      expect(sha(body.code_verifier)).toBe(challenge);
      return Response.json(session(mode === "wrong-issued-user" ? otherId : userId));
    }
    if (url.pathname === "/auth/v1/user") {
      events.push("get-user");
      return Response.json({ ...h.user, id: mode === "wrong-issued-user" ? otherId : userId });
    }
    throw new Error("unexpected local protocol fixture request");
  });
  return { fetcher, events };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", config.authOrigin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "unit-test-public-key");
  vi.stubEnv("SUPABASE_SERVER_URL", "");
  vi.stubEnv("SUPABASE_SECRET_KEY", "unit-test-secret-key");
  h.config = config; h.active = true; h.owner = userId; h.serial = 0; h.tickets.clear();
  h.user = { id: userId, aud: "authenticated", email: "parent@example.test", created_at: "2026-10-01T00:00:00Z",
    app_metadata: {}, user_metadata: {}, identities: [nativeIdentity] };
  h.signOut.mockReset().mockResolvedValue({ error: null }); h.conflict.mockReset(); h.rpc.mockReset().mockResolvedValue({ data: true, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("mini program native Auth PKCE bridge", () => {
  it("uses the real SDK's outer verifier and the broker's one-use inner verifier", async () => {
    const { fetcher, events } = protocol();
    const result = await exchangeMiniappIdentitySession(config, proof, userId, undefined, fetcher);
    expect(result.user.id).toBe(userId);
    expect(events).toEqual(["authorize", "native-callback", "session", "get-user"]);
    expect(h.tickets.size).toBe(0);
    expect(h.signOut).not.toHaveBeenCalled();
  });
  it("links to the existing UUID with the original bearer and session correlation", async () => {
    h.owner = null; h.user.identities = [];
    const { fetcher, events } = protocol("ok", true);
    const verify = vi.fn<() => Promise<void>>().mockResolvedValue();
    const result = await exchangeMiniappIdentitySession(config, proof, userId,
      { token: token(sessionId, "aal2"), sessionId, verify }, fetcher);
    expect(result.user.id).toBe(userId);
    expect(events).toEqual(["link", "native-callback", "session", "get-user"]);
    expect(verify).toHaveBeenCalledTimes(3);
  });
  it.each(["wrong-provider", "wrong-correlation"] as const)("rejects %s before issuing a grant", async (mode) => {
    const { fetcher } = protocol(mode);
    await expect(exchangeMiniappIdentitySession(config, proof, userId, undefined, fetcher)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(h.tickets.size).toBe(0);
  });
  it("rejects an unsafe final destination without following it", async () => {
    const { fetcher, events } = protocol("wrong-completion");
    await expect(exchangeMiniappIdentitySession(config, proof, userId, undefined, fetcher)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(events).not.toContain("session");
  });
  it("rechecks ownership immediately before issuing the grant", async () => {
    const { fetcher } = protocol("owner-changed");
    await expect(exchangeMiniappIdentitySession(config, proof, userId, undefined, fetcher)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.conflict).toHaveBeenCalledWith(userId, proof.subject); expect(h.tickets.size).toBe(0);
  });
  it("never grants an unknown login identity or an inactive account", async () => {
    const { fetcher } = protocol();
    h.owner = null;
    await expect(exchangeMiniappIdentitySession(config, proof, userId, undefined, fetcher)).rejects.toMatchObject({ code: "CONFLICT" });
    h.owner = userId; h.active = false;
    await expect(exchangeMiniappIdentitySession(config, proof, userId, undefined, fetcher)).rejects.toMatchObject({ code: "ACCOUNT_SECURITY" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not create a native session when the inner PKCE is wrong", async () => {
    const { fetcher, events } = protocol("bad-inner-pkce");
    await expect(exchangeMiniappIdentitySession(config, proof, userId, undefined, fetcher)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(events).not.toContain("session");
  });
  it("revokes an issued session when Auth returns another account", async () => {
    const { fetcher } = protocol("wrong-issued-user");
    await expect(exchangeMiniappIdentitySession(config, proof, userId, undefined, fetcher)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.signOut).toHaveBeenCalledWith(token(issuedId, "aal1", otherId), "local");
  });
  it("stops a binding when its original session changes before the grant", async () => {
    h.owner = null; h.user.identities = [];
    const { fetcher } = protocol("ok", true);
    const verify = vi.fn<() => Promise<void>>().mockResolvedValueOnce().mockRejectedValue(new Error("changed session"));
    await expect(exchangeMiniappIdentitySession(config, proof, userId, { token: token(sessionId, "aal2"), sessionId, verify }, fetcher)).rejects.toThrow("changed session");
    expect(h.tickets.size).toBe(0);
  });
});

describe("existing credential and session boundaries", () => {
  it("reads verified factors without treating a plain AAL1 token as AAL2", async () => {
    h.user.factors = [{ id: "factor", factor_type: "totp", status: "verified", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }];
    const { fetcher } = protocol();
    expect((await miniappSessionContext(config, token(sessionId, "aal1"), userId, fetcher)).mfaRequired).toBe(true);
    expect((await miniappSessionContext(config, token(sessionId, "aal2"), userId, fetcher)).mfaRequired).toBe(false);
  });
  it("requires the expected UUID and session_id after getUser", async () => {
    const { fetcher } = protocol();
    await expect(miniappSessionContext(config, token(sessionId, "aal1", otherId), userId, fetcher)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(miniappSessionContext(config, token("not-a-uuid"), userId, fetcher)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it.each(["ok", "wrong-password-user"] as const)("always revokes the separate password verification session: %s", async (mode) => {
    const { fetcher } = protocol(mode);
    const result = verifyMiniappWechatPassword(config, h.user, "unit-password", fetcher);
    if (mode === "ok") await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toMatchObject({ code: "UNAUTHENTICATED", reason: "WECHAT_CREDENTIALS_INVALID" });
    expect(h.signOut).toHaveBeenCalledWith(token(issuedId, "aal1", mode === "ok" ? userId : otherId), "local");
  });
  it("requires explicit phone-only compatibility before password verification", async () => {
    const { fetcher } = protocol();
    await expect(verifyMiniappWechatPassword({ ...config, phoneLinking: false }, { ...h.user, email: undefined, phone: "+8613800000000" }, "unit-password", fetcher))
      .rejects.toMatchObject({ code: "UNAVAILABLE", reason: "WECHAT_PHONE_LINKING_UNAVAILABLE" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves the original MFA session and revokes only a distinct issued session", async () => {
    await revokeMiniappSession(token(sessionId, "aal2"), sessionId);
    expect(h.signOut).not.toHaveBeenCalled();
    await revokeMiniappSession(token(), sessionId);
    expect(h.signOut).toHaveBeenCalledWith(token(), "local");
  });
  it("uses an account-wide password limit and an opaque source limit", async () => {
    const request = new Request(config.completionUrl, { headers: { "x-real-ip": "127.0.0.1" } });
    await limitMiniappWechat(request, "bind", userId);
    await limitMiniappWechat(request, "login");
    const calls = h.rpc.mock.calls;
    expect(calls[0]).toEqual(["allow_wechat_oauth_attempt", { p_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/), p_limit: 8 }]);
    expect(calls[1][1].p_limit).toBe(20);
    expect(JSON.stringify(calls)).not.toContain(userId); expect(JSON.stringify(calls)).not.toContain("127.0.0.1");
    h.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(limitMiniappWechat(request, "login")).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });
});
