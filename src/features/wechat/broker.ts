import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authReturnOrigin, requestPublicOrigin } from "@/lib/auth-return-origin";
import { requireWechatConfig } from "./config";
import { WECHAT_FLOW_COOKIE, WECHAT_GUEST_COOKIE, WECHAT_PROVIDER, opaqueTokenSchema, wechatError, type WechatIdentity } from "./contract";
import { assertWechatFlowSession, setWechatCookie } from "./session";
import {
  assertAccountActive, brokerRequestSchema, completionSchema, findWechatUser, flowSchema, grantSchema,
  issueTicket, readGuest, readTicket, recordWechatConflict, stateSchema,
} from "./store";
import { equalSecret, exchangeWechatCode, randomToken, tokenHash, verifyPkce, wechatAuthorizationUrl, wechatClaims } from "./provider";

const privateHeaders = { "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache", "Referrer-Policy": "no-referrer" };
export const privateRedirect = (url: string | URL) => NextResponse.redirect(url, { status: 303, headers: privateHeaders });
const failure = () => NextResponse.json({ error: "invalid_request" }, { status: 400, headers: privateHeaders });

async function finishWechatAuthorization(state: z.infer<typeof stateSchema>, identity: WechatIdentity, browser: string) {
  const config = requireWechatConfig();
  const owner = await findWechatUser(identity.subject);
  const { flow, broker } = state;
  await assertWechatFlowSession(flow);
  if (flow.mode === "login" && !owner) {
    const token = randomToken();
    await issueTicket("guest", identity, token, 840, token);
    await setWechatCookie(WECHAT_GUEST_COOKIE, token, 840);
    await setWechatCookie(WECHAT_FLOW_COOKIE, "", 0);
    return privateRedirect(`${config.siteOrigin}/${flow.locale}/auth/wechat/guest`);
  }
  const userId = flow.mode === "link" ? flow.userId : owner;
  if (!userId) throw new Error("expired");
  await assertAccountActive(userId);
  if (flow.mode === "link") {
    const { data, error } = await createAdminClient().auth.admin.getUserById(userId);
    if (error || !data.user) throw new Error("failed");
    if ((owner && owner !== userId) || data.user.identities?.some((item) => item.provider === WECHAT_PROVIDER && item.identity_data?.sub !== identity.subject)) {
      await recordWechatConflict(userId, identity.subject);
      throw new Error("conflict");
    }
  }
  const completed = { flow, userId, identity };
  await issueTicket("completion", completed, browser, 180, browser);
  const code = await issueTicket("grant", { ...completed, broker }, config.clientId, 60);
  const callback = new URL(config.authCallbackUrl);
  callback.search = new URLSearchParams({ code, state: broker.state }).toString();
  return privateRedirect(callback);
}

/** Supabase 标准 OAuth → 微信非标准 token/userinfo 接口的最小适配。 */
export async function authorizeWechat(request: Request) {
  let locale = "zh";
  let mode = "login";
  try {
    const config = requireWechatConfig();
    const url = new URL(request.url);
    const broker = brokerRequestSchema.parse(Object.fromEntries(url.searchParams));
    if (broker.client_id !== config.clientId || broker.redirect_uri !== config.authCallbackUrl) return failure();
    const browser = (await cookies()).get(WECHAT_FLOW_COOKIE)?.value;
    if (!browser || !opaqueTokenSchema.safeParse(browser).success || !equalSecret(tokenHash(browser), broker.mathin_flow)) return failure();
    const flow = await readTicket("flow", browser, browser, flowSchema, true);
    if (!flow) throw new Error("expired");
    locale = flow.locale;
    mode = flow.mode;
    await assertWechatFlowSession(flow);
    // 在原账号里明确确认绑定后，复用同一浏览器刚才的微信证明。
    const guest = flow.mode === "link" ? await readGuest(true) : null;
    if (guest) {
      await setWechatCookie(WECHAT_GUEST_COOKIE, "", 0);
      return await finishWechatAuthorization({ flow, broker }, guest, browser);
    }
    const state = await issueTicket("state", { flow, broker }, browser, 600);
    return privateRedirect(wechatAuthorizationUrl(config, state, flow.locale));
  } catch (error) {
    return wechatFailureRedirect(request, locale, mode, error);
  }
}

export function wechatFailureRedirect(request: Request, locale: string, mode: string, error: unknown) {
  const code = wechatError(error instanceof Error ? error.message : null);
  const path = mode === "link" ? `/${locale}/dashboard/account-security?section=identities&wechatError=${code}` : `/${locale}/login?wechatError=${code}`;
  let origin = authReturnOrigin(request);
  try { origin = requireWechatConfig().siteOrigin; } catch { /* 未启用时使用已配置的站点源。 */ }
  return privateRedirect(new URL(path, origin));
}

export async function completeWechatAuthorization(request: Request) {
  let locale = "zh";
  let mode = "login";
  try {
    const config = requireWechatConfig();
    const url = new URL(request.url);
    if (requestPublicOrigin(request) !== config.siteOrigin) throw new Error("unavailable");
    const browser = (await cookies()).get(WECHAT_FLOW_COOKIE)?.value;
    const stateToken = url.searchParams.get("state") ?? undefined;
    if (!browser || !opaqueTokenSchema.safeParse(browser).success) throw new Error("expired");
    const state = await readTicket("state", stateToken, browser, stateSchema, true);
    if (!state) throw new Error("expired");
    locale = state.flow.locale;
    mode = state.flow.mode;
    await assertWechatFlowSession(state.flow);
    const identity = await exchangeWechatCode(config, url.searchParams.get("code") ?? "");
    return await finishWechatAuthorization(state, identity, browser);
  } catch (error) {
    return wechatFailureRedirect(request, locale, mode, error);
  }
}

const exchangeSchema = z.object({
  grant_type: z.literal("authorization_code"), code: opaqueTokenSchema,
  redirect_uri: z.string().url().max(2048), code_verifier: z.string().min(43).max(128),
  client_id: z.string().max(100).optional(), client_secret: z.string().max(2048).optional(),
});

export async function exchangeBrokerToken(request: Request) {
  try {
    const config = requireWechatConfig();
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return failure();
    const body = await request.text();
    if (body.length > 8192) return failure();
    const input = exchangeSchema.parse(Object.fromEntries(new URLSearchParams(body)));
    const authorization = request.headers.get("authorization");
    let clientId = input.client_id ?? "";
    let clientSecret = input.client_secret ?? "";
    if (authorization?.startsWith("Basic ")) {
      const credentials = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const separator = credentials.indexOf(":");
      clientId = decodeURIComponent(credentials.slice(0, separator));
      clientSecret = decodeURIComponent(credentials.slice(separator + 1));
    }
    if (!equalSecret(clientId, config.clientId) || !equalSecret(clientSecret, config.clientSecret) || input.redirect_uri !== config.authCallbackUrl) return failure();
    const grant = await readTicket("grant", input.code, config.clientId, grantSchema, true);
    if (!grant || grant.broker.redirect_uri !== input.redirect_uri || !verifyPkce(input.code_verifier, grant.broker.code_challenge)) return failure();
    await assertAccountActive(grant.userId);
    const access = await issueTicket("access", grant, config.clientId, 60);
    return NextResponse.json({ access_token: access, token_type: "Bearer", expires_in: 60 }, { headers: privateHeaders });
  } catch { return failure(); }
}

export async function brokerUserInfo(request: Request) {
  try {
    const config = requireWechatConfig();
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return failure();
    const grant = await readTicket("access", authorization.slice(7), config.clientId, grantSchema, true);
    if (!grant) return failure();
    await assertAccountActive(grant.userId);
    const owner = await findWechatUser(grant.identity.subject);
    if ((grant.flow.mode === "login" && owner !== grant.userId) || (owner && owner !== grant.userId)) return failure();
    return NextResponse.json(wechatClaims(grant.identity), { headers: privateHeaders });
  } catch { return failure(); }
}

export async function takeWechatCompletion() {
  const browser = (await cookies()).get(WECHAT_FLOW_COOKIE)?.value;
  return browser ? readTicket("completion", browser, browser, completionSchema, true) : null;
}
