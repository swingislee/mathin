"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getProfile, requireUser } from "@/lib/auth";
import { resolveAvailableEnvironments } from "@/lib/environment";
import { resolveSafeReturnTo } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const envSchema = z.object({
  locale: z.enum(["zh", "en"]),
  env: z.enum(["staff", "family", "learning"]),
  returnTo: z.string().nullable().optional(),
});

/**
 * P4I-1：切换使用环境（不是切换岗位/权限）。服务端复核目标环境确实在账号
 * 的可用集合内——前端隐藏不可用的按钮只是体验，不是权限依据。
 */
export async function setActiveEnvironmentAction(formData: FormData) {
  const parsed = envSchema.safeParse({
    locale: formData.get("locale"),
    env: formData.get("env"),
    returnTo: formData.get("returnTo"),
  });
  if (!parsed.success) redirect("/zh/dashboard");
  const { locale, env, returnTo } = parsed.data;

  const user = await requireUser(locale);
  const profile = await getProfile(user.id);
  const supabase = await createClient();
  const available = await resolveAvailableEnvironments(supabase, user.id, profile?.role);

  if (!available.includes(env)) redirect(`/${locale}/dashboard`);

  await supabase.from("profiles").update({ last_active_environment: env }).eq("id", user.id);

  const target = resolveSafeReturnTo(returnTo, locale, `/${locale}/dashboard`);
  // 切换环境后落地页往往和发起请求的页面同路径（都是 /dashboard），Next 的 Router
  // Cache 会把这次导航当软导航复用旧 RSC payload；显式失效目标路径避免读到切换前的视图。
  revalidatePath(target);
  redirect(target);
}
