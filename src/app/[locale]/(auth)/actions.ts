"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { resolveSafeReturnTo } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const signupSchema = z.object({
  displayName: z.string().trim().min(1).max(50),
  inviteCode: z.string().trim().min(6).max(32),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(6).max(128),
  privacyConsent: z.literal("on"),
  childrenPrivacyConsent: z.literal("on"),
});

function safeLocale(value: FormDataEntryValue | null) { return value === "en" ? "en" : "zh"; }
function safeNext(value: FormDataEntryValue | null, locale: string) {
  return resolveSafeReturnTo(typeof value === "string" ? value : null, locale, `/${locale}/dashboard`);
}

export async function login(formData: FormData) {
  const locale = safeLocale(formData.get("locale"));
  const next = safeNext(formData.get("next"), locale);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? "") });
  if (error) redirect(`/${locale}/login?error=credentials`);
  redirect(next);
}

export async function signup(formData: FormData) {
  const locale = safeLocale(formData.get("locale"));
  const parsed = signupSchema.safeParse({
    displayName: formData.get("displayName"),
    inviteCode: formData.get("inviteCode"),
    email: formData.get("email"),
    password: formData.get("password"),
    privacyConsent: formData.get("privacyConsent"),
    childrenPrivacyConsent: formData.get("childrenPrivacyConsent"),
  });
  if (!parsed.success) redirect(`/${locale}/signup?error=validation`);

  const supabase = await createClient();
  const { data: inviteValid, error: inviteError } = await supabase.rpc("validate_registration_invite", {
    p_code: parsed.data.inviteCode,
  });
  if (inviteError || !inviteValid) redirect(`/${locale}/signup?error=invite`);

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        display_name: parsed.data.displayName,
        registration_invite_code: parsed.data.inviteCode,
        privacy_consent: true,
        children_privacy_consent: true,
      },
    },
  });
  if (error) redirect(`/${locale}/signup?error=signup`);
  redirect(`/${locale}/dashboard`);
}

export async function logout(formData: FormData) {
  const locale = safeLocale(formData.get("locale"));
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/${locale}`);
}
