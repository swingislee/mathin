"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { loginIdentifierSchema } from "@/lib/auth-identifier";
import { resolveSafeReturnTo } from "@/lib/safe-redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { WECHAT_FLOW_COOKIE, WECHAT_GUEST_COOKIE } from "@/features/wechat/contract";
import type { LoginState } from "@/components/auth/login-contract";

const loginSchema = z.object({
  identifier: loginIdentifierSchema,
  password: z.string().min(6).max(128),
});
const signupSchema = z
  .object({
    displayName: z.string().trim().min(1).max(50),
    inviteCode: z.string().trim().min(6).max(32),
    identifier: loginIdentifierSchema,
    password: z.string().min(8).max(128),
    passwordConfirm: z.string().min(8).max(128),
    privacyConsent: z.literal("on"),
    childrenPrivacyConsent: z.literal("on"),
  })
  .refine((value) => value.password === value.passwordConfirm, { path: ["passwordConfirm"] });
const recoverySchema = z.object({
  locale: z.enum(["zh", "en"]),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
});

function safeLocale(value: FormDataEntryValue | null) { return value === "en" ? "en" : "zh"; }
function safeNext(value: FormDataEntryValue | null, locale: string) {
  return resolveSafeReturnTo(typeof value === "string" ? value : null, locale, `/${locale}/dashboard`);
}

async function phonePasswordAvailable() {
  const { url, key } = getSupabaseConfig();
  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      cache: "no-store",
      headers: { apikey: key },
    });
    if (!response.ok) return false;
    const settings = await response.json() as { external?: { phone?: boolean } };
    return settings.external?.phone === true;
  } catch {
    return false;
  }
}

async function authenticatePassword(formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, code: "credentials" };

  const credentials = parsed.data.identifier.kind === "email"
    ? { email: parsed.data.identifier.value, password: parsed.data.password }
    : { phone: parsed.data.identifier.value, password: parsed.data.password };
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword(credentials);
    if (error) return { ok: false, code: error.status && error.status >= 500 ? "unavailable" : "credentials" };
    return { ok: true };
  } catch { return { ok: false, code: "unavailable" }; }
}

export async function login(formData: FormData) {
  const locale = safeLocale(formData.get("locale"));
  const next = safeNext(formData.get("next"), locale);
  const result = await authenticatePassword(formData);
  if (!result.ok) redirect(`/${locale}/login?error=${result.code}&next=${encodeURIComponent(next)}`);
  redirect(next);
}

const loginPresentationSchema = z.enum(["page", "dialog"]);

/** 浮窗错误留在卡片中；受限页的完整登录仍由服务端跳回安全 next。 */
export async function submitLogin(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const presentation = loginPresentationSchema.safeParse(formData.get("presentation"));
  if (!presentation.success) return { ok: false, code: "credentials" };
  const result = await authenticatePassword(formData);
  if (!result.ok || presentation.data === "dialog") return result;
  const locale = safeLocale(formData.get("locale"));
  redirect(safeNext(formData.get("next"), locale));
}

export async function signup(formData: FormData) {
  const locale = safeLocale(formData.get("locale"));
  const parsed = signupSchema.safeParse({
    displayName: formData.get("displayName"),
    inviteCode: formData.get("inviteCode"),
    identifier: formData.get("username"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
    privacyConsent: formData.get("privacyConsent"),
    childrenPrivacyConsent: formData.get("childrenPrivacyConsent"),
  });
  if (!parsed.success) redirect(`/${locale}/signup?error=validation`);

  const supabase = await createClient();
  const { data: inviteValid, error: inviteError } = await supabase.rpc("validate_registration_access_v2", {
    p_code: parsed.data.inviteCode,
    p_identifier_type: parsed.data.identifier.kind,
    p_identifier: parsed.data.identifier.value,
  });
  if (inviteError || !inviteValid) redirect(`/${locale}/signup?error=invite`);

  const metadata = {
    display_name: parsed.data.displayName,
    registration_invite_code: parsed.data.inviteCode,
    privacy_consent: true,
    children_privacy_consent: true,
  };

  if (parsed.data.identifier.kind === "phone") {
    if (!await phonePasswordAvailable()) redirect(`/${locale}/signup?error=method`);
    const admin = createAdminClient();
    const { error: createError } = await admin.auth.admin.createUser({
      phone: parsed.data.identifier.value,
      password: parsed.data.password,
      phone_confirm: true,
      user_metadata: metadata,
    });
    if (createError) redirect(`/${locale}/signup?error=signup`);
    const { error: loginError } = await supabase.auth.signInWithPassword({
      phone: parsed.data.identifier.value,
      password: parsed.data.password,
    });
    if (loginError) redirect(`/${locale}/login?error=credentials`);
  } else {
    const { error } = await supabase.auth.signUp({
      email: parsed.data.identifier.value,
      password: parsed.data.password,
      options: {
        data: metadata,
      },
    });
    if (error) redirect(`/${locale}/signup?error=signup`);
  }
  redirect(`/${locale}/dashboard`);
}

export async function logout(formData: FormData) {
  const locale = safeLocale(formData.get("locale"));
  const supabase = await createClient();
  try {
    await supabase.rpc("revoke_all_my_web_push_subscriptions");
  } catch {
    // 通知撤销为尽力清理；调用异常时继续执行会话退出。
  }
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(WECHAT_FLOW_COOKIE);
  cookieStore.delete(WECHAT_GUEST_COOKIE);
  redirect(`/${locale}`);
}

export async function requestPasswordRecovery(formData: FormData) {
  const parsed = recoverySchema.safeParse({
    locale: safeLocale(formData.get("locale")),
    email: formData.get("email"),
  });
  const locale = parsed.success ? parsed.data.locale : safeLocale(formData.get("locale"));
  if (parsed.success) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (siteUrl) {
      const next = encodeURIComponent(`/${locale}/dashboard/account-security?recovery=1`);
      const supabase = await createClient();
      await supabase.auth.resetPasswordForEmail(parsed.data.email, {
        redirectTo: `${siteUrl}/${locale}/auth/callback?next=${next}`,
      });
    }
  }
  redirect(`/${locale}/forgot-password?sent=1`);
}
