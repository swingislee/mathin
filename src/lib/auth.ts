import { redirect } from "next/navigation";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { PERMISSION_KEYS, type PermissionKey } from "@/features/school/permissions";
import { pickActiveEnvironment, resolveAvailableEnvironments, type UserEnvironment } from "@/lib/environment";
import { hasLocalDevelopmentMfaExemption } from "@/lib/local-development-security";
import { hasTrustedWechatSession } from "@/features/wechat/trusted-session";
import { createClient } from "@/lib/supabase/server";

export type ProfileRole = "student" | "parent" | "staff" | "admin";

/** 服务端请求中的登录身份，字段来自已验签的 access token。 */
export interface AuthUser {
  id: string;
  email: string | undefined;
  phone: string | undefined;
  app_metadata: Record<string, unknown>;
  aal: string | undefined;
}

/**
 * 本次服务端请求的登录身份。Supabase 以 ES256 签发 access token，getClaims 用进程级缓存的
 * JWKS 在本机验签，布局、页面和读取函数不再各自往返 GoTrue；过期会话先用 refresh token 续期。
 * 随后按会话主键确认会话仍在：已退出、被其他设备注销或到期的会话立即失效。
 * 账号停用与资料由 requireUser 读取 profiles 把关；绑定、改密等需要完整身份资料时用 getVerifiedUser。
 */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  const { data: active, error: sessionError } = await supabase.rpc("current_auth_session_active");
  // 会话检查不可用时回到 GoTrue 校验，保持注销即时生效。
  if (sessionError ? !(await getVerifiedUser()) : active !== true) return null;
  return {
    id: claims.sub,
    email: claims.email || undefined,
    phone: claims.phone || undefined,
    app_metadata: (claims.app_metadata ?? {}) as Record<string, unknown>,
    aal: claims.aal,
  };
});

/** 向 GoTrue 读取完整账号（identities、确认时间等），用于账号安全与身份绑定。 */
export const getVerifiedUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

/** 布局与页面共用的账号状态；同一请求只读取一次。 */
const readAccountGate = cache(async (userId: string) => {
  const supabase = await createClient();
  const [{ data: account, error: accountError }, { data: consentReady, error: consentError }] = await Promise.all([
    supabase.from("profiles").select("role,account_status,password_change_required").eq("id", userId).maybeSingle<{
      role: ProfileRole;
      account_status: "active" | "locked";
      password_change_required: boolean;
    }>(),
    supabase.rpc("has_current_required_consents", { p_user_id: userId }),
  ]);
  if (accountError) throw new Error(accountError.message);
  if (consentError) throw new Error(consentError.message);
  return { account, consentReady };
});

export interface Profile {
  id: string;
  role: ProfileRole;
  displayName: string;
  avatarUrl: string | null;
  preferredLocale: "zh" | "en";
  lastActiveEnvironment: UserEnvironment;
  passwordChangeRequired: boolean;
}

export async function requireUser(locale: string, options: { allowAccountRecovery?: boolean } = {}): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) redirect(`/${locale}/login`);
  const { account, consentReady } = await readAccountGate(user.id);
  // 本地验签不感知已删除账号；缺少资料时再向 GoTrue 确认账号仍然存在。
  if (!account && !(await getVerifiedUser())) redirect(`/${locale}/login`);
  if (account?.account_status === "locked") {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
    redirect(`/${locale}/login?error=locked`);
  }
  if (!options.allowAccountRecovery && account?.password_change_required) {
    redirect(`/${locale}/dashboard/account-security?required=password`);
  }
  if (!options.allowAccountRecovery && consentReady === false) {
    redirect(`/${locale}/dashboard/account-security?required=consent`);
  }
  const localDevelopmentMfaExempt = hasLocalDevelopmentMfaExemption(user.app_metadata, {
    nodeEnv: process.env.NODE_ENV,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    localProductionPreview: process.env.MATHIN_LOCAL_PRODUCTION_PREVIEW,
  });
  // 通过微信回调核验的当前会话可直接进入；密码登录仍按原生 AAL 要求 MFA。
  if (!options.allowAccountRecovery && account?.role === "admin" && !localDevelopmentMfaExempt && user.aal !== "aal2"
    && !(await hasTrustedWechatSession(user.id))) {
    redirect(`/${locale}/dashboard/account-security?required=mfa`);
  }
  return user;
}

/** 身份绑定等操作：通过 requireUser 的账号闸门后，向 GoTrue 读取完整账号（identities、确认状态）。 */
export async function requireVerifiedUser(locale: string, options: { allowAccountRecovery?: boolean } = {}): Promise<User> {
  await requireUser(locale, options);
  const user = await getVerifiedUser();
  if (!user) redirect(`/${locale}/login`);
  return user;
}

// 布局、环境与权限读取在同一服务端请求内共用资料；后续请求重新读取。
export const getProfile = cache(async (userId: string): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,role,display_name,avatar_url,preferred_locale,last_active_environment,password_change_required")
    .eq("id", userId)
    .maybeSingle<{
      id: string;
      role: ProfileRole;
      display_name: string;
      avatar_url: string | null;
      preferred_locale: "zh" | "en";
      last_active_environment: UserEnvironment;
      password_change_required: boolean;
    }>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    role: data.role,
    displayName: data.display_name,
    avatarUrl: data.avatar_url,
    preferredLocale: data.preferred_locale,
    lastActiveEnvironment: data.last_active_environment,
    passwordChangeRequired: Boolean(data.password_change_required),
  };
});

export const getMyPerms = cache(async (userId: string): Promise<Set<PermissionKey>> => {
  const profile = await getProfile(userId);
  if (!profile) return new Set();
  if (profile.role !== "staff" && profile.role !== "admin") return new Set();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_permission_keys");
  if (error) throw new Error(error.message);

  const perms = new Set<PermissionKey>();
  for (const row of data ?? []) {
    if ((PERMISSION_KEYS as readonly string[]).includes(row.perm_key)) {
      perms.add(row.perm_key as PermissionKey);
    }
  }
  return perms;
});

/** 账号可用的使用环境；页头切换与环境闸门共用同一次读取。 */
export const getAvailableEnvironments = cache(async (userId: string): Promise<UserEnvironment[]> => {
  const profile = await getProfile(userId);
  const supabase = await createClient();
  return resolveAvailableEnvironments(supabase, userId, profile?.role);
});

/** 当前账号实际处在的使用环境（staff / family / learning），按关系集合 + 偏好推导。 */
export const getActiveEnvironment = cache(async (userId: string): Promise<UserEnvironment | null> => {
  const [profile, available] = await Promise.all([getProfile(userId), getAvailableEnvironments(userId)]);
  return pickActiveEnvironment(profile?.lastActiveEnvironment, available);
});

/**
 * 环境闸门（历史设计：archive/2026-10-04/docs/plan/22-dashboard-route-information-architecture-refactor.md §10）：路由先按使用环境放行，再按权限键放行。
 *
 * 两者管的不是一回事。权限键回答"这个人能不能做这件事"，使用环境回答"他现在是以
 * 什么身份在看后台"——员工兼家长切到家庭视角时，侧栏已经换成家庭导航，直接敲
 * /dashboard/students 的 URL 也不该再落进员工页面。此前 staff 页面只靠
 * `getMyPerms` 对非员工返回空集合来挡人，那挡的是角色而不是环境。
 */
export async function requireDashboardEnvironment(locale: string, allowed: readonly UserEnvironment[]) {
  const user = await requireUser(locale);
  const environment = await getActiveEnvironment(user.id);
  if (!environment || !allowed.includes(environment)) redirect(`/${locale}/dashboard`);
  return { user, environment };
}

/** 员工页面的统一入口：先过 staff 环境闸门，再验权限键。 */
export async function requirePerm(locale: string, key: PermissionKey) {
  const { user } = await requireDashboardEnvironment(locale, ["staff"]);
  const perms = await getMyPerms(user.id);
  if (!perms.has(key)) redirect(`/${locale}/dashboard`);
  return user;
}

export async function requireAnyPerm(locale: string, keys: readonly PermissionKey[]) {
  const { user } = await requireDashboardEnvironment(locale, ["staff"]);
  const perms = await getMyPerms(user.id);
  if (!keys.some((key) => perms.has(key))) redirect(`/${locale}/dashboard`);
  return user;
}
