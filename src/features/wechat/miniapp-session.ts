import "server-only";
import { createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { createClient, type Session, type User } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerFetch } from "@/lib/supabase/server-transport";
import { WECHAT_PROVIDER, safeWechatAvatar, type WechatIdentity } from "./contract";
import type { MiniappWechatConfig } from "./miniapp-config";
import { MiniappWechatError } from "./miniapp-provider";
import { equalSecret, randomToken, tokenHash } from "./provider";
import { assertAccountActive, brokerRequestSchema, findWechatUser, issueTicket, recordWechatConflict } from "./store";

/** Auth 的短期 code 留在服务端；node transport 避开 Next 的 URL 调试与跟踪层。 */
const privateAuthRequest: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const headers = Object.fromEntries(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)));
  const body = init?.body ?? (input instanceof Request ? await input.text() : undefined);
  if (body != null && typeof body !== "string") throw new MiniappWechatError("UNAVAILABLE");
  return new Promise<Response>((resolve, reject) => {
    const fail = () => reject(new MiniappWechatError("UNAVAILABLE"));
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method, headers, timeout: 15_000, signal: AbortSignal.timeout(15_000),
    }, (response) => {
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 65_536) { response.destroy(); fail(); return; }
        chunks.push(chunk);
      });
      response.on("error", fail);
      response.on("end", () => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const status = response.statusCode ?? 502;
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers: responseHeaders }));
      });
    });
    request.on("timeout", () => { request.destroy(); fail(); });
    request.on("error", fail);
    request.end(body ?? undefined);
  });
};

/** 限流凭据只保存 HMAC；原始来源、密码和微信标识不进入表或日志。 */
export async function limitMiniappWechat(request: Request, purpose: "login" | "bind", userId?: string) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  const source = request.headers.get("x-real-ip");
  const identifier = userId ?? (source && isIP(source) ? source : "direct");
  if (!secret || (purpose === "bind" && !userId)) throw new MiniappWechatError("UNAVAILABLE");
  const key = createHmac("sha256", secret).update(`miniapp-wechat:${purpose}:${identifier}`).digest("hex");
  const { data, error } = await createAdminClient().rpc("allow_wechat_oauth_attempt", { p_key_hash: key, p_limit: purpose === "bind" ? 8 : 20 });
  if (error) throw new MiniappWechatError("UNAVAILABLE");
  if (!data) throw new MiniappWechatError("RATE_LIMIT");
}

export function createMiniappAuthClient(config: MiniappWechatConfig, bearer?: string, transport: typeof fetch = privateAuthRequest) {
  const { url, key } = getSupabaseConfig();
  if (new URL(url).origin !== config.authOrigin) throw new MiniappWechatError("UNAVAILABLE");
  const values = new Map<string, string>();
  return createClient(url, key, {
    auth: { flowType: "pkce", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: (name) => values.get(name) ?? null,
        setItem: (name, value) => { values.set(name, value); }, removeItem: (name) => { values.delete(name); } } },
    global: { fetch: createSupabaseServerFetch(url, process.env.SUPABASE_SERVER_URL, transport) ?? transport,
      ...(bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {}) },
  });
}

export async function assertMiniappWechatAccount(userId: string) {
  try { await assertAccountActive(userId); }
  catch (error) {
    throw new MiniappWechatError(error instanceof Error && error.message === "failed" ? "ACCOUNT_SECURITY" : "UNAVAILABLE");
  }
}

export async function revokeMiniappSession(token: string, preserveSessionId?: string) {
  if (preserveSessionId) {
    // token 已由原生 Auth 签发并经 getUser 验证；这里只据 session_id 决定撤销范围。
    let sessionId: string;
    try { sessionId = z.object({ session_id: z.string().uuid() }).parse(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))).session_id; }
    catch { throw new MiniappWechatError("UNAVAILABLE"); }
    if (sessionId === preserveSessionId) return;
  }
  const { error } = await createAdminClient().auth.admin.signOut(token, "local");
  if (error) throw new MiniappWechatError("UNAVAILABLE");
}

/** 使用经 getUser 验证的 token 读取会话合同，不把 JWT 解码本身当身份验证。 */
export async function miniappSessionContext(config: MiniappWechatConfig, token: string, expectedUserId: string, transport?: typeof fetch) {
  const client = createMiniappAuthClient(config, token, transport);
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || user?.id !== expectedUserId) throw new MiniappWechatError("UNAUTHENTICATED");
  const { data, error: claimsError } = await client.auth.getClaims(token);
  const claims = z.object({ sub: z.literal(expectedUserId), session_id: z.string().uuid(), aal: z.enum(["aal1", "aal2"]) }).safeParse(data?.claims);
  if (claimsError || !claims.success) throw new MiniappWechatError("UNAUTHENTICATED");
  const mfaRequired = user.factors?.some((factor) => factor.status === "verified") && claims.data.aal !== "aal2";
  return { user, sessionId: claims.data.session_id, mfaRequired: Boolean(mfaRequired) };
}

export async function verifyMiniappWechatPassword(config: MiniappWechatConfig, user: User, password: string, transport?: typeof fetch) {
  const identifier = user.email ? { email: user.email } : user.phone ? { phone: user.phone } : null;
  if (!identifier) throw new MiniappWechatError("UNAUTHENTICATED", "WECHAT_CREDENTIALS_INVALID");
  if (!user.email && !config.phoneLinking) throw new MiniappWechatError("UNAVAILABLE", "WECHAT_PHONE_LINKING_UNAVAILABLE");
  const verifier = createMiniappAuthClient(config, undefined, transport);
  const { data, error } = await verifier.auth.signInWithPassword({ ...identifier, password });
  try {
    if (error || !data.session || data.user?.id !== user.id) {
      throw new MiniappWechatError("UNAUTHENTICATED", "WECHAT_CREDENTIALS_INVALID");
    }
  } finally {
    if (data.session) await revokeMiniappSession(data.session.access_token);
  }
}

type BindingContext = { token: string; sessionId: string; verify: () => Promise<void> };

async function checkedOwner(identity: WechatIdentity, userId: string, binding?: BindingContext) {
  await assertMiniappWechatAccount(userId);
  const owner = await findWechatUser(identity.subject);
  const { data, error } = await createAdminClient().auth.admin.getUserById(userId);
  if (error || !data.user) throw new MiniappWechatError("UNAVAILABLE");
  const otherIdentity = data.user.identities?.some((item) => item.provider === WECHAT_PROVIDER && item.identity_data?.sub !== identity.subject);
  if ((owner && owner !== userId) || (!binding && owner !== userId) || otherIdentity) {
    await recordWechatConflict(userId, identity.subject);
    throw new MiniappWechatError("CONFLICT");
  }
  return data.user;
}

function exactUrl(raw: string, expected: string) {
  const url = new URL(raw);
  const target = new URL(expected);
  if (url.origin !== target.origin || url.pathname !== target.pathname || url.username || url.password || url.hash) {
    throw new MiniappWechatError("UNAVAILABLE");
  }
  return url;
}

/** 真实微信证明后走两段原生 PKCE；没有自行签 JWT、假邮箱或直接写 auth.identities。 */
export async function exchangeMiniappIdentitySession(config: MiniappWechatConfig, proof: WechatIdentity, userId: string, binding?: BindingContext, transport: typeof fetch = privateAuthRequest): Promise<Session> {
  const user = await checkedOwner(proof, userId, binding);
  const existing = user.identities?.find((item) => item.provider === WECHAT_PROVIDER && item.identity_data?.sub === proof.subject);
  const name = existing?.identity_data?.name;
  const identity: WechatIdentity = { ...proof,
    nickname: typeof name === "string" ? name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100) : "",
    avatarUrl: safeWechatAvatar(existing?.identity_data?.picture) };
  const client = createMiniappAuthClient(config, binding?.token, transport);
  const correlation = tokenHash(randomToken());
  const options = { redirectTo: config.completionUrl, skipBrowserRedirect: true, queryParams: { mathin_flow: correlation } };
  await binding?.verify();
  const start = binding
    ? await client.auth.linkIdentity({ provider: WECHAT_PROVIDER, options })
    : await client.auth.signInWithOAuth({ provider: WECHAT_PROVIDER, options });
  if (start.error || !start.data.url) throw new MiniappWechatError("UNAVAILABLE");
  const authTransport = createSupabaseServerFetch(config.authOrigin, process.env.SUPABASE_SERVER_URL, transport) ?? transport;
  let authorizationUrl = start.data.url;
  if (!binding) {
    const authorize = exactUrl(authorizationUrl, `${config.authOrigin}/auth/v1/authorize`);
    const started = await authTransport(authorize, { redirect: "manual", cache: "no-store" });
    if (started.status < 300 || started.status >= 400 || !started.headers.get("location")) throw new MiniappWechatError("UNAVAILABLE");
    authorizationUrl = new URL(started.headers.get("location")!, authorize).toString();
  }
  // 只解析受控 provider 地址；无需浏览器、Cookie 或访问 website authorize 入口。
  const authorize = exactUrl(authorizationUrl, `${config.siteOrigin}/zh/auth/wechat/authorize`);
  const broker = brokerRequestSchema.safeParse(Object.fromEntries(authorize.searchParams));
  if (!broker.success || broker.data.client_id !== config.clientId || broker.data.redirect_uri !== config.authCallbackUrl
    || !equalSecret(broker.data.mathin_flow, correlation)) throw new MiniappWechatError("UNAVAILABLE");
  await binding?.verify();
  await checkedOwner(identity, userId, binding);
  const flow = { mode: binding ? "link" as const : "login" as const, locale: "zh" as const, next: "/",
    userId: binding ? userId : null, sessionId: binding?.sessionId ?? null };
  const grant = await issueTicket("grant", { flow, userId, identity, broker: broker.data }, config.clientId, 60);
  const callback = new URL(config.authCallbackUrl);
  callback.search = new URLSearchParams({ code: grant, state: broker.data.state }).toString();
  const completed = await authTransport(callback, { redirect: "manual", cache: "no-store" });
  if (completed.status < 300 || completed.status >= 400 || !completed.headers.get("location")) throw new MiniappWechatError("UNAVAILABLE");
  const destination = exactUrl(new URL(completed.headers.get("location")!, callback).toString(), config.completionUrl);
  const code = destination.searchParams.get("code");
  if (!code || code.length > 2048 || destination.searchParams.has("error")) throw new MiniappWechatError("UNAVAILABLE");
  const result = await client.auth.exchangeCodeForSession(code);
  if (result.error || !result.data.session) throw new MiniappWechatError("UNAVAILABLE");
  const session = result.data.session;
  try {
    const current = await client.auth.getUser(session.access_token);
    if (current.error || current.data.user?.id !== userId
      || !current.data.user.identities?.some((item) => item.provider === WECHAT_PROVIDER && item.identity_data?.sub === identity.subject)
      || await findWechatUser(identity.subject) !== userId) throw new MiniappWechatError("CONFLICT");
    await assertMiniappWechatAccount(userId);
    await binding?.verify();
    return session;
  } catch (error) {
    await revokeMiniappSession(session.access_token, binding?.sessionId);
    throw error;
  }
}
