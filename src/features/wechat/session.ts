import "server-only";
import { cookies, headers } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerFetch } from "@/lib/supabase/server-transport";
import { WECHAT_FLOW_COOKIE, WECHAT_PROVIDER } from "./contract";
import { requireWechatConfig } from "./config";
import { issueTicket, type WechatFlow } from "./store";
import { randomToken, tokenHash } from "./provider";
import { checkWechatRateLimit } from "./rate-limit";

export async function currentWechatAuthContext() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user) {
    if (error && error.name !== "AuthSessionMissingError") throw new Error("failed");
    return { user: null, userId: null, sessionId: null };
  }
  const { data, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || data?.claims.sub !== user.id || typeof data.claims.session_id !== "string") throw new Error("failed");
  return { user, userId: user.id, sessionId: data.claims.session_id };
}

export async function assertWechatFlowSession(flow: WechatFlow) {
  const context = await currentWechatAuthContext();
  if (context.userId !== flow.userId || context.sessionId !== flow.sessionId) throw new Error("expired");
  return context;
}

export async function setWechatCookie(name: string, token: string, maxAge = 600) {
  (await cookies()).set(name, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge });
}

export async function beginWechatFlow(flow: WechatFlow): Promise<string> {
  const config = requireWechatConfig();
  const requestHeaders = await headers();
  if (requestHeaders.get("origin") !== config.siteOrigin) throw new Error("unavailable");
  await checkWechatRateLimit("start");
  const supabase = await createClient();
  const token = randomToken();
  await issueTicket("flow", flow, token, 600, token);
  await setWechatCookie(WECHAT_FLOW_COOKIE, token);
  const options = {
    redirectTo: `${config.siteOrigin}/${flow.locale}/auth/callback?wechat=1`,
    queryParams: { mathin_flow: tokenHash(token) }, skipBrowserRedirect: true,
  };
  const result = flow.mode === "link"
    ? await supabase.auth.linkIdentity({ provider: WECHAT_PROVIDER, options })
    : await supabase.auth.signInWithOAuth({ provider: WECHAT_PROVIDER, options });
  if (result.error || !result.data.url) throw new Error("unavailable");
  // SDK URL 必须属于当前已登记的 Auth 源，避免配置漂移造成凭据跨环境传输。
  const destination = new URL(result.data.url);
  const expectedOrigin = flow.mode === "link" ? config.siteOrigin : new URL(config.authCallbackUrl).origin;
  if (destination.origin !== expectedOrigin
    || (flow.mode === "link" && destination.pathname !== "/zh/auth/wechat/authorize")) throw new Error("unavailable");
  return result.data.url;
}

/** 单独验证原密码，不替换浏览器当前会话或降低原有 MFA 等级。 */
export async function verifyWechatLinkPassword(userId: string, identifier: { email: string } | { phone: string }, password: string) {
  await checkWechatRateLimit("password", userId);
  const { url, key } = getSupabaseConfig();
  const verifier = createSupabaseClient(url, key, {
    global: { fetch: createSupabaseServerFetch(url) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await verifier.auth.signInWithPassword({ ...identifier, password });
  try {
    if (error || data.user?.id !== userId) throw new Error("credentials");
  } finally {
    if (data.session) await verifier.auth.signOut({ scope: "local" });
  }
  const supabase = await createClient();
  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError || !assurance || (assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2")) throw new Error("credentials");
}
