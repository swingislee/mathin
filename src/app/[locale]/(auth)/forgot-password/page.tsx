import { getTranslations, setRequestLocale } from "next-intl/server";
import { requestPasswordRecovery } from "@/app/[locale]/(auth)/actions";
import { Star4 } from "@/components/star4";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";

export default async function ForgotPasswordPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ sent?: string }> }) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  return <main className="grid min-h-dvh place-items-center px-6 py-16"><div className="flex w-full max-w-md flex-col items-center"><Star4 size={24} className="mb-6"/><form action={requestPasswordRecovery} className="w-full rounded-[2rem] border bg-card p-8 shadow-sm"><Link href="/" className="font-display text-xl">Mathin</Link><h1 className="mb-3 mt-7 font-display text-3xl">{t("forgotTitle")}</h1><p className="mb-7 text-sm leading-6 text-muted">{t("forgotIntro")}</p><Input type="hidden" name="locale" value={locale}/><Label className="mb-2 block" htmlFor="recovery-email">{t("email")}</Label><Input id="recovery-email" name="email" type="email" required autoComplete="email" className="h-11 rounded-full bg-transparent px-4"/>{query.sent && <p role="status" className="mt-4 text-sm text-crater">{t("recoveryRequested")}</p>}<Button className="mt-7 w-full" size="lg" type="submit">{t("sendRecovery")}</Button><Link href="/login" className="mt-5 block text-center text-sm underline underline-offset-2">{t("backToLogin")}</Link></form></div></main>;
}
