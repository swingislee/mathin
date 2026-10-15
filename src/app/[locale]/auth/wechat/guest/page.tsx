import Image from "next/image";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { LoginLink } from "@/components/auth/LoginLink";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Star4 } from "@/components/star4";
import { createClient } from "@/lib/supabase/server";
import { getWechatConfig } from "@/features/wechat/config";
import { leaveWechatGuest } from "@/features/wechat/actions";
import { readGuest } from "@/features/wechat/store";

async function GuestBody({ locale }: { locale: string }) {
  const t = await getTranslations("wechat");
  if (!getWechatConfig()) redirect(`/${locale}/login?wechatError=unavailable`);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect(`/${locale}/dashboard/account-security?section=identities`);
  const guest = await readGuest();
  if (!guest) redirect(`/${locale}/login?wechatError=expired`);
  return <>
    <div className="flex items-center gap-4">
      {guest.avatarUrl ? <Image src={guest.avatarUrl} alt="" width={64} height={64} className="rounded-full" referrerPolicy="no-referrer" /> : <Star4 size={32} />}
      <div><p className="text-sm text-muted">{t("guestLabel")}</p><h1 className="font-display text-3xl">{guest.nickname || t("guestTitle")}</h1></div>
    </div>
    <p className="mt-6 leading-7 text-muted">{t("guestNotice")}</p>
    <p className="mt-3 text-sm leading-6 text-muted">{t("guestRoles")}</p>
    <div className="mt-7 flex flex-wrap gap-3">
      <LoginLink className={buttonVariants()} next={`/${locale}/dashboard/account-security?section=identities`}>{t("existingAccount")}</LoginLink>
      <Link className={buttonVariants({ variant: "secondary" })} href="/">{t("browse")}</Link>
    </div>
    <p className="mt-5 text-xs leading-5 text-muted">{t("guestExpiry")}</p>
    <p className="mt-2 text-xs leading-5 text-muted">{t("phoneNotice")}</p>
    <form action={leaveWechatGuest} className="mt-5"><Input type="hidden" name="locale" value={locale} /><Button type="submit" variant="ghost">{t("leave")}</Button></form>
  </>;
}

export default async function WechatGuestPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <main className="mx-auto min-h-dvh max-w-2xl px-6 py-16"><Link href="/" className="mb-12 block font-display text-xl">Mathin</Link><Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-line" />}><GuestBody locale={locale} /></Suspense></main>;
}
