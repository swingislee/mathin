import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWechatConfig, requireWechatConfig, type WechatConfig } from "./config";
import { WECHAT_PROVIDER } from "./contract";
import { tokenHash } from "./provider";

const COOKIE = "__Host-mathin_wechat_session";
const MAX_AGE = 30 * 24 * 60 * 60;
const proofSchema = z.object({
  userId: z.string().uuid(), sessionId: z.string().uuid(),
  subjectHash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int().positive(),
});

function signature(payload: string, config: WechatConfig) {
  return createHmac("sha256", config.clientSecret)
    .update(JSON.stringify(["mathin-wechat-session-v1", config.siteOrigin, config.authCallbackUrl, payload]))
    .digest("base64url");
}

/** 只在微信回调已经核验真实微信身份与账号归属之后调用。保留 Auth 原生 AAL。 */
export async function rememberWechatSession(userId: string, subject: string) {
  const config = requireWechatConfig();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || data?.claims.sub !== userId) throw new Error("failed");
  const proof = proofSchema.parse({
    userId, sessionId: data.claims.session_id, subjectHash: tokenHash(subject),
    expiresAt: Math.floor(Date.now() / 1000) + MAX_AGE,
  });
  const payload = Buffer.from(JSON.stringify(proof)).toString("base64url");
  (await cookies()).set(COOKIE, `${payload}.${signature(payload, config)}`, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: MAX_AGE,
  });
}

/** 当前会话与仍然绑定的微信均须匹配；账号有微信身份本身不能豁免密码登录的 MFA。 */
export const hasTrustedWechatSession = cache(async (userId: string): Promise<boolean> => {
  const config = getWechatConfig();
  if (!config) return false;
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || token.length > 2048) return false;
  try {
    const parts = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!parts || !timingSafeEqual(Buffer.from(parts[2]), Buffer.from(signature(parts[1], config)))) return false;
    const proof = proofSchema.parse(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
    if (proof.userId !== userId || proof.expiresAt <= Math.floor(Date.now() / 1000)) return false;
    const supabase = await createClient();
    const { data: claims, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || claims?.claims.sub !== userId || claims.claims.session_id !== proof.sessionId) return false;
    // getUser 读取权威身份，微信解绑后立即失效；不信任 JWT 的旧 providers 或可编辑资料。
    const { data, error } = await supabase.auth.getUser();
    return !error && data.user?.id === userId && Boolean(data.user.identities?.some((identity) =>
      identity.provider === WECHAT_PROVIDER && typeof identity.identity_data?.sub === "string"
      && tokenHash(identity.identity_data.sub) === proof.subjectHash));
  } catch { return false; }
});
