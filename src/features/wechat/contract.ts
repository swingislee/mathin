import { z } from "zod";

export const WECHAT_PROVIDER = "custom:wechat" as const;
export const WECHAT_FLOW_COOKIE = "mathin_wechat_flow";
export const WECHAT_GUEST_COOKIE = "mathin_wechat_guest";
export const WECHAT_ERRORS = ["unavailable", "expired", "conflict", "credentials", "phoneCompatibility", "rateLimited", "failed"] as const;
export type WechatError = (typeof WECHAT_ERRORS)[number];
export const opaqueTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const wechatIdentitySchema = z.object({
  subject: z.string().min(1).max(200),
  openid: z.string().min(1).max(128),
  unionid: z.string().min(1).max(128),
  nickname: z.string().max(100),
  avatarUrl: z.string().max(2048).nullable(),
  authorizedAt: z.string().datetime(),
});
export type WechatIdentity = z.infer<typeof wechatIdentitySchema>;
export type WechatAccountState = {
  available: boolean;
  phoneLinkingAvailable: boolean;
  linked: boolean;
  nickname: string | null;
  avatarUrl: string | null;
  pendingNickname: string | null;
};

export function wechatError(value: unknown): WechatError {
  return WECHAT_ERRORS.includes(value as WechatError) ? value as WechatError : "failed";
}

/** 微信头像只接受官方头像主机；外部数据不能成为任意图片代理 URL。 */
export function safeWechatAvatar(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || !value) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port
      || !["thirdwx.qlogo.cn", "wx.qlogo.cn"].includes(url.hostname)) return null;
    url.protocol = "https:";
    url.hash = "";
    return url.toString();
  } catch { return null; }
}
