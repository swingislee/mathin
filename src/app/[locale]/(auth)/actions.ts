"use server";

import { redirect } from "next/navigation";
import { resolveSafeReturnTo } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

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
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? "") });
  if (error) redirect(`/${locale}/signup?error=signup`);
  redirect(`/${locale}/dashboard`);
}

export async function logout(formData: FormData) {
  const locale = safeLocale(formData.get("locale"));
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/${locale}`);
}
