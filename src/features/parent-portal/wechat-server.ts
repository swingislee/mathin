import "server-only";
import type { ParentWechatAuthStatus, ParentWechatAuthResult } from "../../../contracts/parent-api/portal";
import { WECHAT_PROVIDER } from "@/features/wechat/contract";
import { getMiniappWechatConfig } from "@/features/wechat/miniapp-config";
import { exchangeMiniappWechatCode, MiniappWechatError } from "@/features/wechat/miniapp-provider";
import { assertMiniappWechatAccount, exchangeMiniappIdentitySession, limitMiniappWechat,
  miniappSessionContext, revokeMiniappSession, verifyMiniappWechatPassword } from "@/features/wechat/miniapp-session";
import { findWechatUser, recordWechatConflict } from "@/features/wechat/store";
import { authorize, failure, PortalError, readJson, response } from "./server";
import { parentWechatAuthCommandSchema } from "./wechat-contract";

export function parentWechatAuthFailure(error: unknown) {
  if (!(error instanceof MiniappWechatError)) return failure(error);
  const result = failure(new PortalError(error.code));
  return error.reason ? response({ code: error.code, reason: error.reason }, result.status) : result;
}

export async function parentWechatAuthGet(request: Request) {
  const config = getMiniappWechatConfig();
  if (!request.headers.has("authorization")) {
    return response({ available: Boolean(config), linked: null, canBind: false } satisfies ParentWechatAuthStatus);
  }
  const { user, token } = await authorize(request);
  await assertMiniappWechatAccount(user.id);
  const linked = Boolean(user.identities?.some((identity) => identity.provider === WECHAT_PROVIDER));
  const context = config && !linked ? await miniappSessionContext(config, token, user.id) : null;
  return response({ available: Boolean(config), linked,
    canBind: Boolean(config && !linked && (user.email || (user.phone && config.phoneLinking)) && !context?.mfaRequired) } satisfies ParentWechatAuthStatus);
}

export async function parentWechatAuthPost(request: Request) {
  const input = parentWechatAuthCommandSchema.parse(await readJson(request));
  const config = getMiniappWechatConfig();
  if (!config) throw new MiniappWechatError("UNAVAILABLE", "WECHAT_NOT_CONFIGURED");
  if (input.action === "login") {
    await limitMiniappWechat(request, "login");
    const identity = await exchangeMiniappWechatCode(config, input.code);
    const userId = await findWechatUser(identity.subject);
    if (!userId) return response({ state: "binding_required" } satisfies ParentWechatAuthResult);
    await assertMiniappWechatAccount(userId);
    const session = await exchangeMiniappIdentitySession(config, identity, userId);
    try {
      await authorize(new Request(request.url, { headers: { authorization: `Bearer ${session.access_token}` } }));
      const context = await miniappSessionContext(config, session.access_token, userId);
      if (context.mfaRequired) throw new MiniappWechatError("ACCOUNT_SECURITY", "WECHAT_MFA_REQUIRED");
      if (!session.expires_at) throw new MiniappWechatError("UNAVAILABLE");
      return response({ state: "authenticated", session: { accessToken: session.access_token,
        refreshToken: session.refresh_token, expiresAt: session.expires_at } } satisfies ParentWechatAuthResult);
    } catch (error) {
      await revokeMiniappSession(session.access_token);
      throw error;
    }
  }
  const { user, token } = await authorize(request);
  await assertMiniappWechatAccount(user.id);
  await limitMiniappWechat(request, "bind", user.id);
  const initial = await miniappSessionContext(config, token, user.id);
  if (initial.mfaRequired) throw new MiniappWechatError("ACCOUNT_SECURITY", "WECHAT_MFA_REQUIRED");
  await verifyMiniappWechatPassword(config, initial.user, input.password);
  const identity = await exchangeMiniappWechatCode(config, input.code);
  const verify = async () => {
    await authorize(request);
    await assertMiniappWechatAccount(user.id);
    const current = await miniappSessionContext(config, token, user.id);
    if (current.sessionId !== initial.sessionId) throw new MiniappWechatError("UNAUTHENTICATED");
    if (current.mfaRequired) throw new MiniappWechatError("ACCOUNT_SECURITY", "WECHAT_MFA_REQUIRED");
    return current;
  };
  const current = await verify();
  const owner = await findWechatUser(identity.subject);
  const linked = current.user.identities?.find((item) => item.provider === WECHAT_PROVIDER);
  if ((owner && owner !== user.id) || (linked && linked.identity_data?.sub !== identity.subject)) {
    await recordWechatConflict(user.id, identity.subject);
    throw new MiniappWechatError("CONFLICT");
  }
  if (linked && owner === user.id) return response({ state: "bound" } satisfies ParentWechatAuthResult);
  const session = await exchangeMiniappIdentitySession(config, identity, user.id,
    { token, sessionId: initial.sessionId, verify: async () => { await verify(); } });
  // 手动绑定产生的临时 OAuth 会话不替换当前凭据，也不降低现有 MFA 等级。
  await revokeMiniappSession(session.access_token, initial.sessionId);
  await verify();
  return response({ state: "bound" } satisfies ParentWechatAuthResult);
}
