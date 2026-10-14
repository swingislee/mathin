import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { WechatConfig } from "@/features/wechat/config";
import type { WechatChannel, WechatIdentity } from "@/features/wechat/contract";
vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({
  cookies: new Map<string, string>(), tickets: new Map<string, { kind: string; payload: object; browser: string }>(),
  owner: null as string | null, userId: null as string | null, sessionId: null as string | null,
  channel: "website" as WechatChannel, guest: null as WechatIdentity | null,
  existing: false, active: true, conflict: vi.fn(), exchange: vi.fn(), serial: 0,
}));
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const browser = "a".repeat(64);
const verifier = "v".repeat(64);
const config: WechatConfig = {
  appId: "touristappid", appSecret: "not-a-secret", namespace: "mathin", clientId: "mathin-wechat", clientSecret: "not-a-secret",
  siteOrigin: "https://app.example.com", callbackUrl: "https://app.example.com/zh/auth/wechat/callback", authCallbackUrl: "https://auth.example.com/auth/v1/callback", phoneLinking: true,
};
vi.mock("@/features/wechat/config", () => ({ requireWechatConfig: () => config }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => h.cookies.has(name) ? { value: h.cookies.get(name) } : undefined }) }));
vi.mock("@/features/wechat/session", () => ({
  setWechatCookie: async (key: string, value: string) => h.cookies.set(key, value),
  assertWechatFlowSession: async (flow: { userId: string | null; sessionId: string | null }) => {
    if (flow.userId !== h.userId || flow.sessionId !== h.sessionId) throw new Error("expired");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: { getUserById: async () => ({ data: { user: { identities: h.existing ? [{ provider: "custom:wechat", identity_data: { sub: "different-identity" } }] : [] } } }) } } }) }));
vi.mock("@/features/wechat/provider", async (original) => ({ ...await original<object>(), exchangeWechatCode: (...args: unknown[]) => h.exchange(...args) }));
vi.mock("@/features/wechat/store", async (original) => ({
  ...await original<object>(),
  issueTicket: async (kind: string, payload: object, binding: string, _seconds: number, given?: string) => {
    const token = given ?? (++h.serial).toString(16).padStart(64, "0");
    if (h.tickets.has(token)) throw new Error("unavailable");
    h.tickets.set(token, { kind, payload, browser: binding });
    return token;
  },
  readTicket: async (kind: string, token: string, binding: string, schema: z.ZodType, consume: boolean) => {
    const ticket = h.tickets.get(token);
    if (!ticket || ticket.kind !== kind || ticket.browser !== binding) return null;
    if (consume) h.tickets.delete(token);
    return schema.parse(ticket.payload);
  },
  readGuest: async () => h.guest,
  findWechatUser: async () => h.owner,
  assertAccountActive: async () => { if (!h.active) throw new Error("failed"); },
  recordWechatConflict: (...args: unknown[]) => h.conflict(...args),
}));
import { authorizeWechat, completeWechatAuthorization, exchangeBrokerToken, brokerUserInfo } from "@/features/wechat/broker";
import { tokenHash } from "@/features/wechat/provider";

const profile = { subject: "mathin:union-user", openid: "website-user", unionid: "union-user", nickname: "Test", avatarUrl: null, authorizedAt: "2026-09-24T00:00:00.000Z" };
beforeEach(() => {
  h.cookies.clear(); h.tickets.clear(); h.serial = 0; h.owner = null; h.userId = null; h.sessionId = null; h.existing = false; h.active = true;
  h.exchange.mockReset().mockResolvedValue(profile); h.conflict.mockReset();
  h.channel = "website"; h.guest = null;
  config.officialAccount = { appId: "official-account-fixture", appSecret: "official-fixture-secret" };
});

function authorizationRequest(patch = {}, headers?: HeadersInit) {
  const query = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.authCallbackUrl, response_type: "code", state: "supabase-state",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", mathin_flow: tokenHash(browser), ...patch,
  });
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("user-agent") && h.channel === "officialAccount") requestHeaders.set("user-agent", "MicroMessenger/8.0.63");
  return new Request(`${config.siteOrigin}/zh/auth/wechat/authorize?${query}`, { headers: requestHeaders });
}
async function authorize(mode = "login", patch = {}, headers?: HeadersInit) {
  h.cookies.set("mathin_wechat_flow", browser);
  if (mode === "link") { h.userId = userId; h.sessionId = sessionId; }
  h.tickets.set(browser, { kind: "flow", browser, payload: { mode, userId: h.userId, sessionId: h.sessionId, locale: "zh", next: "/zh/dashboard" } });
  return authorizeWechat(authorizationRequest(patch, headers));
}
async function callback(state: string, patch = {}, headers?: HeadersInit) {
  const query = new URLSearchParams({ code: "wechat-code", state, ...patch });
  return completeWechatAuthorization(new Request(`${config.callbackUrl}?${query}`, { headers }));
}
async function grantFor(mode = "login") {
  const start = await authorize(mode);
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const response = await callback(state);
  return { response, code: new URL(response.headers.get("location")!).searchParams.get("code")! };
}
function tokenRequest(code: string, override = {}) {
  return new Request(`${config.siteOrigin}/zh/auth/wechat/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config.authCallbackUrl, ...override }),
  });
}

describe.each(["website", "officialAccount"] as const)("WeChat %s broker security boundaries", (channel) => {
  beforeEach(() => { h.channel = channel; });
  it.each(["login", "link"])("keeps the %s ticket through RSC pre-reads and consumes it only on navigation", async (mode) => {
    const preRead = await authorize(mode, {}, { rsc: "1" });
    expect(preRead.status).toBe(204);
    expect(preRead.headers.get("cache-control")).toContain("no-store");
    expect(preRead.headers.get("location")).toBeNull();
    expect(h.tickets.has(browser)).toBe(true);
    expect([...h.tickets.values()].map((ticket) => ticket.kind)).toEqual(["flow"]);

    const prefetch = await authorizeWechat(authorizationRequest({}, { rsc: "1", "next-router-prefetch": "1" }));
    expect(prefetch.status).toBe(204);
    expect(h.tickets.has(browser)).toBe(true);
    expect(h.exchange).not.toHaveBeenCalled();

    const navigation = await authorizeWechat(authorizationRequest());
    expect(navigation.status).toBe(303);
    expect(new URL(navigation.headers.get("location")!).hostname).toBe("open.weixin.qq.com");
    expect(new URL(navigation.headers.get("location")!).pathname).toBe(channel === "website" ? "/connect/qrconnect" : "/connect/oauth2/authorize");
    expect(h.tickets.has(browser)).toBe(false);
    expect([...h.tickets.values()].map((ticket) => ticket.kind)).toEqual(["state"]);
    const replay = await authorizeWechat(authorizationRequest());
    expect(replay.headers.get("location")).toContain("wechatError=expired");
    expect([...h.tickets.values()].map((ticket) => ticket.kind)).toEqual(["state"]);
  });
  it("gives unknown identities a guest proof and never releases an Auth grant", async () => {
    const { response } = await grantFor();
    expect(response.headers.get("location")).toBe(`${config.siteOrigin}/zh/auth/wechat/guest`);
    expect([...h.tickets.values()].map((ticket) => ticket.kind)).toEqual(["guest"]);
    expect(h.cookies.get("mathin_wechat_flow")).toBe("");
  });
  it("rejects an arbitrary callback, weak PKCE, or missing browser correlation", async () => {
    expect((await authorize("login", { redirect_uri: "https://evil.example/callback" })).status).toBe(400);
    expect((await authorize("login", { mathin_flow: "b".repeat(64) })).status).toBe(400);
    const weak = await authorize("login", { code_challenge_method: "plain" });
    expect(weak.headers.get("location")).toContain("wechatError=failed");
    expect(h.exchange).not.toHaveBeenCalled();
  });
  it("allows only one consumer of a state, including concurrent replay", async () => {
    const start = await authorize();
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const responses = await Promise.all([callback(state), callback(state)]);
    expect(h.exchange).toHaveBeenCalledTimes(1);
    expect(responses.filter((r) => r.headers.get("location")?.includes("wechatError=expired"))).toHaveLength(1);
  });
  it("rejects account and session switching before exchanging the WeChat code", async () => {
    const start = await authorize("link");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    h.sessionId = otherId;
    expect((await callback(state)).headers.get("location")).toContain("wechatError=expired");
    expect(h.exchange).not.toHaveBeenCalled();
  });
  it("keeps both users intact when the WeChat identity belongs to another account", async () => {
    h.owner = otherId;
    const { response } = await grantFor("link");
    expect(response.headers.get("location")).toContain("wechatError=conflict");
    expect(h.conflict).toHaveBeenCalledWith(userId, profile.subject);
    expect([...h.tickets.values()].some((ticket) => ticket.kind === "grant")).toBe(false);
  });
  it("rejects linking a second WeChat identity to the same account", async () => {
    h.existing = true;
    expect((await grantFor("link")).response.headers.get("location")).toContain("wechatError=conflict");
  });
  it("rejects a locked account instead of falling back to guest access", async () => {
    h.owner = userId; h.active = false;
    expect((await grantFor()).response.headers.get("location")).toContain("wechatError=failed");
    expect([...h.tickets.values()].some((ticket) => ticket.kind === "guest")).toBe(false);
  });
  it("requires client credentials and S256, then consumes code and access tickets once", async () => {
    h.owner = userId;
    const { code } = await grantFor();
    const noClient = tokenRequest(code); noClient.headers.delete("authorization");
    expect((await exchangeBrokerToken(noClient)).status).toBe(400);
    const response = await exchangeBrokerToken(tokenRequest(code));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const data = await response.json();
    expect((await exchangeBrokerToken(tokenRequest(code))).status).toBe(400);
    const infoRequest = () => new Request(`${config.siteOrigin}/zh/auth/wechat/userinfo`, { headers: { authorization: `Bearer ${data.access_token}` } });
    const claims = await (await brokerUserInfo(infoRequest())).json();
    expect(claims.sub).toBe(profile.subject);
    for (const key of ["email", "email_verified", "phone", "role", "access_token"]) expect(claims).not.toHaveProperty(key);
    expect((await brokerUserInfo(infoRequest())).status).toBe(400);
  });
  it("rejects wrong PKCE and unlinked identities before returning userinfo", async () => {
    h.owner = userId;
    let issued = await grantFor();
    expect((await exchangeBrokerToken(tokenRequest(issued.code, { code_verifier: "w".repeat(64) }))).status).toBe(400);
    h.tickets.clear(); issued = await grantFor();
    const data = await (await exchangeBrokerToken(tokenRequest(issued.code))).json();
    h.owner = null;
    expect((await brokerUserInfo(new Request(`${config.siteOrigin}/zh/auth/wechat/userinfo`, { headers: { authorization: `Bearer ${data.access_token}` } }))).status).toBe(400);
  });
});

describe("WeChat authorization channel binding", () => {
  it.each(["login", "link"])("pins the %s channel despite callback parameters or a changed user agent", async (mode) => {
    const start = await authorize(mode, {}, { "user-agent": "MicroMessenger/8.0.63" });
    const destination = new URL(start.headers.get("location")!);
    expect(destination.pathname).toBe("/connect/oauth2/authorize");
    const state = destination.searchParams.get("state")!;
    expect(h.tickets.get(state)?.payload).toHaveProperty("channel", "officialAccount");
    const result = await callback(state, { channel: "website", appid: config.appId }, { "user-agent": "Chrome/130" });
    expect(h.exchange).toHaveBeenCalledWith(config, "wechat-code", undefined, "officialAccount");
    expect(result.headers.get("location")).not.toContain("wechatError");
  });

  it("completes an existing website ticket issued before channel support", async () => {
    const start = await authorize();
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const payload = h.tickets.get(state)!.payload as { channel?: WechatChannel };
    delete payload.channel;
    await callback(state, { channel: "officialAccount" }, { "user-agent": "MicroMessenger/8.0.63" });
    expect(h.exchange).toHaveBeenCalledWith(config, "wechat-code", undefined, "website");
  });

  it.each(["login", "link"])("returns the %s availability message instead of a QR when the official account is absent", async (mode) => {
    config.officialAccount = undefined;
    const result = await authorize(mode, {}, { "user-agent": "MicroMessenger/8.0.63" });
    const destination = new URL(result.headers.get("location")!);
    expect(destination.origin).toBe(config.siteOrigin);
    expect(destination.pathname).toBe(mode === "link" ? "/zh/dashboard/account-security" : "/zh/login");
    expect(destination.searchParams.get("wechatError")).toBe("officialAccountUnavailable");
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(h.tickets.size).toBe(0);
    expect(h.exchange).not.toHaveBeenCalled();
  });

  it.each(["website", "officialAccount"] as const)("requires new %s authorization even with an earlier guest proof", async (channel) => {
    h.channel = channel;
    h.guest = profile;
    h.cookies.set("mathin_wechat_guest", "b".repeat(64));
    const result = await authorize("link");
    const destination = new URL(result.headers.get("location")!);
    expect(destination.origin).toBe("https://open.weixin.qq.com");
    expect(destination.pathname).toBe(channel === "website" ? "/connect/qrconnect" : "/connect/oauth2/authorize");
    expect(h.cookies.get("mathin_wechat_guest")).toBe("");
    expect([...h.tickets.values()].map((ticket) => ticket.kind)).toEqual(["state"]);
    expect(h.exchange).not.toHaveBeenCalled();

    const currentIdentity = { ...profile, subject: "mathin:new-union", unionid: "new-union", openid: "new-openid" };
    h.exchange.mockResolvedValue(currentIdentity);
    const completed = await callback(destination.searchParams.get("state")!);
    expect(new URL(completed.headers.get("location")!).origin).toBe("https://auth.example.com");
    const grant = [...h.tickets.values()].find((ticket) => ticket.kind === "grant");
    expect(grant?.payload).toMatchObject({ userId, identity: currentIdentity });
  });

  it("does not use an earlier guest proof to bypass unavailable authorization", async () => {
    config.officialAccount = undefined; h.guest = profile;
    const result = await authorize("link", {}, { "user-agent": "MicroMessenger/8.0.63" });
    expect(result.headers.get("location")).toContain("wechatError=officialAccountUnavailable");
    expect(h.exchange).not.toHaveBeenCalled();
    expect(h.tickets.size).toBe(0);
  });
});
