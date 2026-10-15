import Image from "next/image";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { LoginLink } from "@/components/auth/LoginLink";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Star4 } from "@/components/star4";
import { createClient } from "@/lib/supabase/server";
import { getWechatConfig } from "@/features/wechat/config";
import { leaveWechatGuest } from "@/features/wechat/actions";
import { WechatLoginButton } from "@/features/wechat/WechatLoginButton";
import { getMiniappWechatConfig } from "@/features/wechat/miniapp-config";
import { miniappEntryCode } from "@/features/wechat/miniapp-phone";
import { readGuest } from "@/features/wechat/store";
import { familyOnboardingAvailable } from "@/features/parent-portal/onboarding-server";

/** 网页不开户：家长转到小程序开户，员工用账号密码登录后关联，其他人先浏览。 */
async function GuestBody({ locale }: { locale: string }) {
  const t = await getTranslations("wechat.guest");
  if (!getWechatConfig()) redirect(`/${locale}/login?wechatError=unavailable`);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect(`/${locale}/dashboard/account-security?section=identities`);
  const guest = await readGuest();
  if (!guest) redirect(`/${locale}/login?wechatError=expired`);
  const miniapp = getMiniappWechatConfig();
  const entryCode = miniapp && familyOnboardingAvailable(miniapp) ? await miniappEntryCode(miniapp) : null;
  return <>
    <div className="flex items-center gap-4">
      {guest.avatarUrl ? <Image src={guest.avatarUrl} alt="" width={56} height={56} className="rounded-full" referrerPolicy="no-referrer" /> : <Star4 size={28} />}
      <div>
        <h1 className="font-display text-2xl">{t("title")}</h1>
        {guest.nickname ? <p className="mt-1 text-sm text-muted">{t("nickname", { name: guest.nickname })}</p> : null}
      </div>
    </div>

    <section className="mt-10">
      <h2 className="font-medium">{t("familyTitle")}</h2>
      {entryCode ? <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
        <Image src={entryCode} alt={t("codeAlt")} width={160} height={160} unoptimized className="size-40 shrink-0 rounded-lg border border-line bg-white p-2" />
        <div className="space-y-4">
          <p className="leading-7 text-muted">{t("familyBody")}</p>
          <div className="max-w-64"><WechatLoginButton locale={locale} available label={t("relogin")} /></div>
        </div>
      </div> : <p className="mt-3 leading-7 text-muted">{t("familyUnavailable")}</p>}
    </section>

    <Separator className="my-8" />

    <section>
      <h2 className="font-medium">{t("staffTitle")}</h2>
      <p className="mt-3 leading-7 text-muted">{t("staffBody")}</p>
      <LoginLink className={buttonVariants({ variant: "secondary", className: "mt-4" })} next={`/${locale}/dashboard/account-security?section=identities`}>{t("staffAction")}</LoginLink>
    </section>

    <Separator className="my-8" />

    <div className="flex flex-wrap items-center gap-3">
      <Link className={buttonVariants({ variant: "ghost" })} href="/">{t("browse")}</Link>
      <form action={leaveWechatGuest}><Input type="hidden" name="locale" value={locale} /><Button type="submit" variant="ghost">{t("leave")}</Button></form>
    </div>
    <p className="mt-3 text-xs leading-5 text-muted">{t("expiry")}</p>
  </>;
}

export default async function WechatGuestPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <main className="mx-auto min-h-dvh max-w-2xl px-6 py-16"><Link href="/" className="mb-12 block font-display text-xl">Mathin</Link><Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-line" />}><GuestBody locale={locale} /></Suspense></main>;
}
