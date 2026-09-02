import { redirect } from "next/navigation";
import { cache } from "react";
import { PERMISSION_KEYS, type PermissionKey } from "@/features/school/permissions";
import { pickActiveEnvironment, resolveAvailableEnvironments, type UserEnvironment } from "@/lib/environment";
import { hasLocalDevelopmentMfaExemption } from "@/lib/local-development-security";
import { createClient } from "@/lib/supabase/server";

export type ProfileRole = "student" | "parent" | "staff" | "admin";

export interface Profile {
  id: string;
  role: ProfileRole;
  displayName: string;
  avatarUrl: string | null;
  preferredLocale: "zh" | "en";
  lastActiveEnvironment: UserEnvironment;
  passwordChangeRequired: boolean;
}

export async function requireUser(locale: string, options: { allowAccountRecovery?: boolean } = {}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  const [{ data: account, error: accountError }, { data: consentReady, error: consentError }] = await Promise.all([
    supabase.from("profiles").select("role,account_status,password_change_required").eq("id", user.id).maybeSingle<{
      role: ProfileRole;
      account_status: "active" | "locked";
      password_change_required: boolean;
    }>(),
    supabase.rpc("has_current_required_consents", { p_user_id: user.id }),
  ]);
  if (accountError) throw new Error(accountError.message);
  if (consentError) throw new Error(consentError.message);
  if (account?.account_status === "locked") {
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
  });
  if (!options.allowAccountRecovery && account?.role === "admin" && !localDevelopmentMfaExempt) {
    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance?.currentLevel !== "aal2") {
      redirect(`/${locale}/dashboard/account-security?required=mfa`);
    }
  }
  return user;
}

export async function getProfile(userId: string): Promise<Profile | null> {
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
}

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

/** 当前账号实际处在的使用环境（staff / family / learning），按关系集合 + 偏好推导。 */
export const getActiveEnvironment = cache(async (userId: string): Promise<UserEnvironment | null> => {
  const profile = await getProfile(userId);
  const supabase = await createClient();
  const available = await resolveAvailableEnvironments(supabase, userId, profile?.role);
  return pickActiveEnvironment(profile?.lastActiveEnvironment, available);
});

/**
 * 环境闸门（docs/plan/22 §10）：路由先按使用环境放行，再按权限键放行。
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
