"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { resolveSafeReturnTo } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import { requireWechatConfig } from "./config";
import { WECHAT_GUEST_COOKIE, WECHAT_PROVIDER, wechatError } from "./contract";
import { beginWechatFlow, currentWechatAuthContext, setWechatCookie, verifyWechatLinkPassword } from "./session";
import { assertAccountActive, readGuest } from "./store";

const loginSchema = z.object({ locale: z.enum(["zh", "en"]), next: z.string().max(2000).nullable() });
const linkSchema = z.object({ locale: z.enum(["zh", "en"]), password: z.string().min(6).max(128), confirm: z.literal("on") });

export async function beginWechatLogin(formData: FormData) {
  const parsed = loginSchema.safeParse({ locale: formData.get("locale"), next: formData.get("next") });
  if (!parsed.success) redirect("/zh/login?wechatError=failed");
  const { locale } = parsed.data;
  let destination: string;
  try {
    const context = await currentWechatAuthContext();
    if (context.user) {
      destination = `/${locale}/dashboard/account-security?section=identities`;
    } else {
      destination = await beginWechatFlow({
        mode: "login", locale, next: resolveSafeReturnTo(parsed.data.next, locale, `/${locale}/dashboard`),
        userId: null, sessionId: null,
      });
    }
  } catch (error) {
    redirect(`/${locale}/login?wechatError=${wechatError(error instanceof Error ? error.message : null)}`);
  }
  redirect(destination);
}

export async function bindWechat(formData: FormData) {
  const parsed = linkSchema.safeParse({ locale: formData.get("locale"), password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) redirect("/zh/dashboard/account-security?section=identities&wechatError=credentials");
  const { locale, password } = parsed.data;
  const next = `/${locale}/dashboard/account-security?section=identities`;
  const user = await requireUser(locale);
  let destination: string;
  try {
    const config = requireWechatConfig();
    await assertAccountActive(user.id);
    if (user.identities?.some((identity) => identity.provider === WECHAT_PROVIDER)) throw new Error("conflict");
    if (!user.email && !config.phoneLinking) throw new Error("phoneCompatibility");
    const identifier = user.email ? { email: user.email } : user.phone ? { phone: user.phone } : null;
    if (!identifier) throw new Error("credentials");
    await verifyWechatLinkPassword(user.id, identifier, password);
    const context = await currentWechatAuthContext();
    if (context.userId !== user.id || !context.sessionId) throw new Error("expired");
    destination = await beginWechatFlow({ mode: "link", locale, next, userId: user.id, sessionId: context.sessionId });
  } catch (error) {
    redirect(`${next}&wechatError=${wechatError(error instanceof Error ? error.message : null)}`);
  }
  redirect(destination);
}

export async function unlinkWechat(formData: FormData) {
  const parsed = linkSchema.safeParse({ locale: formData.get("locale"), password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) redirect("/zh/dashboard/account-security?section=identities&wechatError=credentials");
  const { locale, password } = parsed.data;
  const next = `/${locale}/dashboard/account-security?section=identities`;
  const user = await requireUser(locale);
  try {
    const identifier = user.email ? { email: user.email } : user.phone ? { phone: user.phone } : null;
    const identity = user.identities?.find((item) => item.provider === WECHAT_PROVIDER);
    if (!identifier || !identity || !user.identities?.some((item) => item.provider === "email" || item.provider === "phone")) throw new Error("credentials");
    await verifyWechatLinkPassword(user.id, identifier, password);
    const supabase = await createClient();
    const { error } = await supabase.auth.unlinkIdentity(identity);
    if (error) throw new Error("failed");
    // 解绑后使其他设备的刷新会话失效；当前会话保留，短期 access token 到期前仍受 RLS 控制。
    await supabase.auth.signOut({ scope: "others" });
    await readGuest(true);
    await setWechatCookie(WECHAT_GUEST_COOKIE, "", 0);
  } catch (error) {
    redirect(`${next}&wechatError=${wechatError(error instanceof Error ? error.message : null)}`);
  }
  redirect(`${next}&wechatResult=unlinked`);
}

export async function leaveWechatGuest(formData: FormData) {
  const locale = z.enum(["zh", "en"]).catch("zh").parse(formData.get("locale"));
  await readGuest(true);
  (await cookies()).delete(WECHAT_GUEST_COOKIE);
  redirect(`/${locale}`);
}
