import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { z } from "zod";
import { safeWechatAvatar, type WechatIdentity } from "./contract";
import type { WechatConfig } from "./config";

export const randomToken = () => randomBytes(32).toString("hex");
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function equalSecret(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(tokenHash(left)), Buffer.from(tokenHash(right)));
}
export function verifyPkce(verifier: string, challenge: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
    && equalSecret(createHash("sha256").update(verifier).digest("base64url"), challenge);
}

export function wechatAuthorizationUrl(config: WechatConfig, state: string, locale: string): string {
  const url = new URL("https://open.weixin.qq.com/connect/qrconnect");
  url.search = new URLSearchParams({
    appid: config.appId, redirect_uri: config.callbackUrl, response_type: "code",
    scope: "snsapi_login", state, lang: locale === "en" ? "en" : "cn",
  }).toString();
  url.hash = "wechat_redirect";
  return url.toString();
}

const tokenResponse = z.object({
  access_token: z.string().min(1).max(2048), openid: z.string().min(1).max(128),
  scope: z.string().max(200), unionid: z.string().min(1).max(128).optional(),
});
const userResponse = z.object({
  openid: z.string().min(1).max(128), unionid: z.string().min(1).max(128),
  nickname: z.string().max(100).default(""), headimgurl: z.string().max(2048).optional(),
});

function privateWechatRequest(url: URL): Promise<Response> {
  // 绕过 Next 的 fetch 调试/跟踪层：微信协议把 AppSecret/access_token 放在 query 中。
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { method: "GET", timeout: 10_000, signal: AbortSignal.timeout(10_000) }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16_384) { response.destroy(); reject(new Error("failed")); return; }
        chunks.push(chunk);
      });
      response.on("error", () => reject(new Error("failed")));
      response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 502 })));
    });
    request.on("timeout", () => { request.destroy(); reject(new Error("failed")); });
    request.on("error", () => reject(new Error("failed")));
    request.end();
  });
}

async function wechatJson(url: URL, fetcher?: typeof fetch): Promise<unknown> {
  try {
    const response = fetcher
      ? await fetcher(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) })
      : await privateWechatRequest(url);
    if (!response.ok) throw new Error("failed");
    const body = await response.text();
    if (body.length > 16_384) throw new Error("failed");
    const data = JSON.parse(body);
    if (data.errcode) throw new Error("failed");
    return data;
  } catch { throw new Error("failed"); }
}

export async function exchangeWechatCode(config: WechatConfig, code: string, fetcher?: typeof fetch): Promise<WechatIdentity> {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(code)) throw new Error("expired");
  const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  tokenUrl.search = new URLSearchParams({ appid: config.appId, secret: config.appSecret, code, grant_type: "authorization_code" }).toString();
  const token = tokenResponse.safeParse(await wechatJson(tokenUrl, fetcher));
  if (!token.success || !token.data.scope.split(",").includes("snsapi_login")) throw new Error("failed");
  const infoUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
  infoUrl.search = new URLSearchParams({ access_token: token.data.access_token, openid: token.data.openid, lang: "zh_CN" }).toString();
  const info = userResponse.safeParse(await wechatJson(infoUrl, fetcher));
  if (!info.success || info.data.openid !== token.data.openid
    || (token.data.unionid && token.data.unionid !== info.data.unionid)) throw new Error("failed");
  return {
    // 固定为同一开放平台下的 UnionID；不在缺失时回退 OpenID，避免身份键漂移。
    subject: `${config.namespace}:${info.data.unionid}`, openid: info.data.openid, unionid: info.data.unionid,
    nickname: info.data.nickname.replace(/[\u0000-\u001f\u007f]/g, "").trim(),
    avatarUrl: safeWechatAvatar(info.data.headimgurl), authorizedAt: new Date().toISOString(),
  };
}

/** 无邮箱、手机号或角色声明；Supabase 的原生 identity 是绑定关系权威。 */
export function wechatClaims(identity: WechatIdentity) {
  return { sub: identity.subject, name: identity.nickname, preferred_username: identity.nickname, picture: identity.avatarUrl };
}
