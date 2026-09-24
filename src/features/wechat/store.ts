import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { WECHAT_GUEST_COOKIE, opaqueTokenSchema, wechatIdentitySchema, type WechatIdentity } from "./contract";
import { randomToken, tokenHash } from "./provider";

export type TicketKind = "flow" | "state" | "guest" | "grant" | "access" | "completion";
export const flowSchema = z.object({
  mode: z.enum(["login", "link"]), locale: z.enum(["zh", "en"]), next: z.string().max(2000),
  userId: z.string().uuid().nullable(), sessionId: z.string().uuid().nullable(),
});
export type WechatFlow = z.infer<typeof flowSchema>;
export const brokerRequestSchema = z.object({
  client_id: z.string().min(1).max(100), redirect_uri: z.string().url().max(2048),
  response_type: z.literal("code"), state: z.string().min(1).max(4096),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal("S256"),
  mathin_flow: opaqueTokenSchema,
});
export const stateSchema = z.object({ flow: flowSchema, broker: brokerRequestSchema });
export const completionSchema = z.object({ flow: flowSchema, userId: z.string().uuid(), identity: wechatIdentitySchema });
export const grantSchema = completionSchema.extend({ broker: brokerRequestSchema });

export async function issueTicket(kind: TicketKind, payload: object, browser: string, seconds: number, token = randomToken()): Promise<string> {
  const { error } = await createAdminClient().from("wechat_oauth_tickets").insert({
    token_hash: tokenHash(token), kind, browser_hash: tokenHash(browser), payload,
    expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
  });
  if (error) throw new Error("unavailable");
  return token;
}

export async function readTicket<T>(kind: TicketKind, token: string | undefined, browser: string, schema: z.ZodType<T>, consume = false): Promise<T | null> {
  if (!opaqueTokenSchema.safeParse(token).success) return null;
  const admin = createAdminClient();
  const result = consume
    ? await admin.rpc("consume_wechat_oauth_ticket", { p_token_hash: tokenHash(token!), p_kind: kind, p_browser_hash: tokenHash(browser) })
    : await admin.from("wechat_oauth_tickets").select("payload").eq("token_hash", tokenHash(token!))
      .eq("kind", kind).eq("browser_hash", tokenHash(browser)).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (result.error) throw new Error("unavailable");
  const parsed = schema.safeParse(consume ? result.data : result.data?.payload);
  return parsed.success ? parsed.data : null;
}

export async function readGuest(consume = false): Promise<WechatIdentity | null> {
  const token = (await cookies()).get(WECHAT_GUEST_COOKIE)?.value;
  return token ? readTicket("guest", token, token, wechatIdentitySchema, consume) : null;
}

export async function findWechatUser(subject: string): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc("find_wechat_auth_user", { p_subject: subject });
  if (error) throw new Error("unavailable");
  return data || null;
}

export async function assertAccountActive(userId: string) {
  const { data, error } = await createAdminClient().from("profiles")
    .select("account_status,is_active,password_change_required").eq("id", userId).maybeSingle();
  if (error || !data || data.account_status !== "active" || !data.is_active || data.password_change_required) throw new Error("failed");
}

export async function recordWechatConflict(userId: string, subject: string) {
  const { error } = await createAdminClient().from("wechat_binding_audits").insert({ user_id: userId, event: "conflict", subject_hash: tokenHash(subject) });
  if (error) throw new Error("unavailable");
}

export async function saveWechatSnapshot(userId: string, identity: WechatIdentity) {
  // 再核对身份权威；资料快照不授予登录能力，也不覆盖用户自己编辑的资料。
  if (await findWechatUser(identity.subject) !== userId) throw new Error("conflict");
  const { error } = await createAdminClient().from("wechat_profile_snapshots").upsert({
    user_id: userId, subject: identity.subject, openid: identity.openid, unionid: identity.unionid,
    nickname: identity.nickname, avatar_url: identity.avatarUrl, authorized_at: identity.authorizedAt,
  });
  if (error) throw new Error("unavailable");
}
