import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWechatConfig, requireWechatConfig, type WechatConfig } from "./config";
import { WECHAT_PROVIDER } from "./contract";
import { tokenHash } from "./provider";

const COOKIE = "__Host-mathin_wechat_session";
const MAX_AGE = 30 * 24 * 60 * 60;
const proofSchema = z.object({
  userId: z.string().uuid(), sessionId: z.string().uuid(),
  subjectHash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int().positive(),
});
type Proof = z.infer<typeof proofSchema>;

function signature(payload: string, config: WechatConfig) {
  return createHmac("sha256", config.clientSecret)
    .update(JSON.stringify(["mathin-wechat-session-v1", config.siteOrigin, config.authCallbackUrl, payload]))
    .digest("base64url");
}

async function persistProof(proof: Proof, token: string, identityId: string) {
  const { error } = await createAdminClient().from("wechat_trusted_sessions").upsert({
    session_id: proof.sessionId, user_id: proof.userId, identity_id: z.string().uuid().parse(identityId),
    proof: token, verified_at: new Date((proof.expiresAt - MAX_AGE) * 1000).toISOString(),
    expires_at: new Date(proof.expiresAt * 1000).toISOString(),
  });
  if (error) throw new Error("unavailable");
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
  const { data: current, error: userError } = await supabase.auth.getUser();
  const identity = current.user?.identities?.find((item) =>
    item.provider === WECHAT_PROVIDER && item.identity_data?.sub === subject);
  if (userError || current.user?.id !== userId || !identity) throw new Error("failed");
  const payload = Buffer.from(JSON.stringify(proof)).toString("base64url");
  const token = `${payload}.${signature(payload, config)}`;
  await persistProof(proof, token, identity.identity_id);
  // 保留旧版本可读的 Cookie，支持应用回退；恢复登录时以服务端记录为准。
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: MAX_AGE,
  });
}

/** 当前会话与仍然绑定的微信均须匹配；账号有微信身份本身不能豁免密码登录的 MFA。 */
export const hasTrustedWechatSession = cache(async (userId: string): Promise<boolean> => {
  const config = getWechatConfig();
  if (!config) return false;
  try {
    const supabase = await createClient();
    const { data: claims, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || claims?.claims.sub !== userId) return false;
    const stored = await supabase.rpc("current_wechat_session_proof");
    const token = stored.error ? (await cookies()).get(COOKIE)?.value
      : stored.data ?? (await cookies()).get(COOKIE)?.value;
    if (!token || typeof token !== "string" || token.length > 2048) return false;
    const parts = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!parts || !timingSafeEqual(Buffer.from(parts[2]), Buffer.from(signature(parts[1], config)))) return false;
    const proof = proofSchema.parse(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
    if (proof.userId !== userId || proof.expiresAt <= Math.floor(Date.now() / 1000)) return false;
    if (claims.claims.session_id !== proof.sessionId) return false;
    // getUser 读取权威身份，微信解绑后立即失效；不信任 JWT 的旧 providers 或可编辑资料。
    const { data, error } = await supabase.auth.getUser();
    if (error || data.user?.id !== userId) return false;
    const identity = data.user.identities?.find((item) =>
      item.provider === WECHAT_PROVIDER && typeof item.identity_data?.sub === "string"
      && tokenHash(item.identity_data.sub) === proof.subjectHash);
    if (!identity) return false;
    // 旧 Cookie 只有完整通过原有校验后才迁移，沿用原期限；存储暂不可用时保留旧版本行为。
    if (!stored.error && !stored.data) await persistProof(proof, token, identity.identity_id).catch(() => undefined);
    return true;
  } catch { return false; }
});
