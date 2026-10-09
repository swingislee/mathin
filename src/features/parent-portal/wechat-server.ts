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
import { beginFamilyOnboarding, familyOnboardingAvailable, needsFamilyOnboarding, resumePendingFamily, verifiedAccountPhone } from "./onboarding-server";
import { createAdminClient } from "@/lib/supabase/admin";

async function loginStep<T>(step: "rate_limit" | "wechat_exchange" | "identity_lookup" | "onboarding_proof", run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try { return await run(); }
  catch (error) {
    // Development diagnostics contain no identity, URL, credential or raw upstream error.
    if (process.env.NODE_ENV === "development") console.warn("miniapp-wechat-login", JSON.stringify({
      step, elapsedMs: Date.now() - started, code: error instanceof MiniappWechatError ? error.code : "UNAVAILABLE",
    }));
    throw error;
  }
}

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
    ...(config ? { canBindDirect: Boolean(!linked && config.phoneLinking && verifiedAccountPhone(user) && !context?.mfaRequired) } : {}),
    ...(familyOnboardingAvailable(config) ? { registrationRequired: await needsFamilyOnboarding(user.id) } : {}),
    canBind: Boolean(config && !linked && (user.email || (user.phone && config.phoneLinking)) && !context?.mfaRequired) } satisfies ParentWechatAuthStatus);
}

export async function parentWechatAuthPost(request: Request) {
  const input = parentWechatAuthCommandSchema.parse(await readJson(request));
  const config = getMiniappWechatConfig();
  if (!config) throw new MiniappWechatError("UNAVAILABLE", "WECHAT_NOT_CONFIGURED");
  if (input.action === "login") {
    await loginStep("rate_limit", () => limitMiniappWechat(request, "login"));
    const identity = await loginStep("wechat_exchange", () => exchangeMiniappWechatCode(config, input.code));
    const userId = await loginStep("identity_lookup", () => findWechatUser(identity.subject));
    if (request.headers.has("authorization")) {
      const { user, token } = await authorize(request);
      await assertMiniappWechatAccount(user.id);
      const context = await miniappSessionContext(config, token, user.id);
      if (context.mfaRequired) throw new MiniappWechatError("ACCOUNT_SECURITY", "WECHAT_MFA_REQUIRED");
      if (userId !== user.id) throw new MiniappWechatError("CONFLICT");
      if (familyOnboardingAvailable(config) && await needsFamilyOnboarding(user.id)) {
        return response(await beginFamilyOnboarding(identity, input.scene ?? null, context.user));
      }
      if (input.scene) await recordPromotionTouch(input.scene, user.id);
      return response({ state: "current_session" } satisfies ParentWechatAuthResult);
    }
    if (!userId) return response(familyOnboardingAvailable(config)
      ? await loginStep("onboarding_proof", () => beginFamilyOnboarding(identity, input.scene ?? null))
      : { state: "binding_required" } satisfies ParentWechatAuthResult);
    await assertMiniappWechatAccount(userId);
    if (familyOnboardingAvailable(config)) {
      const resumed = await resumePendingFamily(config, identity, userId);
      if (resumed) return response(resumed);
    }
    const session = await exchangeMiniappIdentitySession(config, identity, userId);
    try {
      await authorize(new Request(request.url, { headers: { authorization: `Bearer ${session.access_token}` } }));
      const context = await miniappSessionContext(config, session.access_token, userId);
      if (context.mfaRequired) throw new MiniappWechatError("ACCOUNT_SECURITY", "WECHAT_MFA_REQUIRED");
      if (!session.expires_at) throw new MiniappWechatError("UNAVAILABLE");
      if (familyOnboardingAvailable(config) && await needsFamilyOnboarding(userId)) {
        const onboarding = await beginFamilyOnboarding(identity, input.scene ?? null, context.user);
        await revokeMiniappSession(session.access_token);
        return response(onboarding);
      }
      if (input.scene) await recordPromotionTouch(input.scene, userId);
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
  if (input.password !== undefined) await verifyMiniappWechatPassword(config, initial.user, input.password);
  else if (!config.phoneLinking || !verifiedAccountPhone(initial.user)) throw new MiniappWechatError("ACCOUNT_SECURITY");
  const identity = await exchangeMiniappWechatCode(config, input.code);
  const verify = async () => {
    await authorize(request);
    await assertMiniappWechatAccount(user.id);
    const current = await miniappSessionContext(config, token, user.id);
    if (current.sessionId !== initial.sessionId) throw new MiniappWechatError("UNAUTHENTICATED");
    if (current.mfaRequired) throw new MiniappWechatError("ACCOUNT_SECURITY", "WECHAT_MFA_REQUIRED");
    if (input.password === undefined && (!verifiedAccountPhone(current.user)
      || verifiedAccountPhone(current.user)?.phone !== verifiedAccountPhone(initial.user)?.phone)) throw new MiniappWechatError("ACCOUNT_SECURITY");
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

async function recordPromotionTouch(scene: string, userId: string) {
  const touched = await (createAdminClient().rpc as unknown as (name: string, args: object) => Promise<{ error: unknown }>)("miniapp_record_promotion_touch", {
    p_scene: scene, p_user: userId,
  });
  if (touched.error) throw new MiniappWechatError("UNAVAILABLE");
}
