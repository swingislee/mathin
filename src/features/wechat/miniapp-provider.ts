import "server-only";
import { z } from "zod";
import type { ApiErrorCode, ParentWechatAuthErrorReason } from "../../../contracts/parent-api/portal";
import type { WechatIdentity } from "./contract";
import type { MiniappWechatConfig } from "./miniapp-config";
import { privateWechatRequest } from "./provider";

export class MiniappWechatError extends Error {
  constructor(public code: ApiErrorCode, public reason?: ParentWechatAuthErrorReason) { super(code); }
}

export const miniappWechatCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const sessionSchema = z.object({
  openid: z.string().min(1).max(128), session_key: z.string().min(1).max(256),
  unionid: z.string().min(1).max(128).optional(),
});

/** 只信任服务端 code2Session 的身份；会话密钥在本函数结束后即丢弃。 */
export async function exchangeMiniappWechatCode(config: MiniappWechatConfig, code: string, fetcher?: typeof fetch): Promise<WechatIdentity> {
  if (!miniappWechatCodeSchema.safeParse(code).success) throw new MiniappWechatError("VALIDATION");
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.search = new URLSearchParams({ appid: config.appId, secret: config.appSecret,
    js_code: code, grant_type: "authorization_code" }).toString();
  try {
    const response = fetcher
      ? await fetcher(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) })
      : await privateWechatRequest(url);
    if (!response.ok) throw new MiniappWechatError("UNAVAILABLE");
    const body = await response.text();
    if (body.length > 16_384) throw new MiniappWechatError("UNAVAILABLE");
    const data: unknown = JSON.parse(body);
    const errorCode = z.object({ errcode: z.number().int().optional() }).safeParse(data);
    if (!errorCode.success) throw new MiniappWechatError("UNAVAILABLE");
    if ([40029, 40163].includes(errorCode.data.errcode ?? 0)) {
      throw new MiniappWechatError("UNAUTHENTICATED", "WECHAT_CODE_INVALID");
    }
    if (errorCode.data.errcode === 45011) throw new MiniappWechatError("RATE_LIMIT");
    if (errorCode.data.errcode) throw new MiniappWechatError("UNAVAILABLE");
    const session = sessionSchema.safeParse(data);
    if (!session.success) throw new MiniappWechatError("UNAVAILABLE");
    if (!session.data.unionid) throw new MiniappWechatError("UNAVAILABLE", "WECHAT_UNIONID_REQUIRED");
    return { subject: `${config.namespace}:${session.data.unionid}`, openid: session.data.openid,
      unionid: session.data.unionid, nickname: "", avatarUrl: null, authorizedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof MiniappWechatError) throw error;
    // 上游错误可能携带凭据 URL，只输出稳定错误码。
    throw new MiniappWechatError("UNAVAILABLE");
  }
}
