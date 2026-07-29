import { getTranslations } from "next-intl/server";
import { login, signup } from "@/app/[locale]/(auth)/actions";
import { Star4 } from "@/components/star4";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export async function AuthForm({ mode, locale, error, next }: { mode: "login" | "signup"; locale: string; error?: string; next?: string }) {
  const t = await getTranslations("auth");
  const common = await getTranslations("common");
  const action = mode === "login" ? login : signup;
  const errorMessage = error === "invite"
    ? t("invalidInvite")
    : error === "validation"
      ? t("invalidRegistration")
      : error === "locked"
        ? t("accountLocked")
        : error
          ? t("error")
          : null;

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-16">
      <div className="flex w-full max-w-md flex-col items-center">
        <Star4 size={24} className="mb-6" />
        <form action={action} className="w-full rounded-[2rem] border bg-card p-8 shadow-sm">
          <Link href="/" className="font-display text-xl">Mathin</Link>
          <h1 className="mb-7 mt-7 font-display text-3xl">{t(mode === "login" ? "loginTitle" : "signupTitle")}</h1>
          <Input type="hidden" name="locale" value={locale} />
          {next && <Input type="hidden" name="next" value={next} />}

          {mode === "signup" && (
            <>
              <Label className="mb-2 block" htmlFor="displayName">{t("displayName")}</Label>
              <Input className="mb-5 h-11 rounded-full bg-transparent px-4" id="displayName" name="displayName" type="text" required maxLength={50} autoComplete="nickname" placeholder={t("displayNamePlaceholder")} />
              <Label className="mb-2 block" htmlFor="inviteCode">{t("inviteCode")}</Label>
              <Input className="mb-5 h-11 rounded-full bg-transparent px-4 uppercase tracking-[0.12em]" id="inviteCode" name="inviteCode" type="text" required minLength={6} maxLength={32} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder={t("inviteCodePlaceholder")} />
            </>
          )}

          <Label className="mb-2 block" htmlFor="email">{t("email")}</Label>
          <Input className="mb-5 h-11 rounded-full bg-transparent px-4" id="email" name="email" type="email" required autoComplete="email" />
          <Label className="mb-2 block" htmlFor="password">{t("password")}</Label>
          <Input className="h-11 rounded-full bg-transparent px-4" id="password" name="password" type="password" minLength={mode === "login" ? 6 : 8} maxLength={128} required autoComplete={mode === "login" ? "current-password" : "new-password"} />

          {mode === "signup" && (
            <div className="mt-6 space-y-3 border-t border-line pt-5">
              <div className="flex items-start gap-3">
                <Checkbox id="privacyConsent" name="privacyConsent" required className="mt-0.5 size-5" />
                <Label htmlFor="privacyConsent" className="text-sm font-normal leading-6 text-muted">
                  {t("privacyAgreement")} <Link href="/privacy" className="text-ink underline underline-offset-2">{common("privacy")}</Link>
                </Label>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox id="childrenPrivacyConsent" name="childrenPrivacyConsent" required className="mt-0.5 size-5" />
                <Label htmlFor="childrenPrivacyConsent" className="text-sm font-normal leading-6 text-muted">
                  {t("childrenPrivacyAgreement")} <Link href="/children-privacy" className="text-ink underline underline-offset-2">{common("childrenPrivacy")}</Link>
                </Label>
              </div>
            </div>
          )}

          {errorMessage && <p className="mt-4 text-sm text-rose" role="alert">{errorMessage}</p>}
          <button className={cn(buttonVariants({ size: "lg" }), "mt-7 w-full")} type="submit">{t(mode)}</button>
          {mode === "login" && <div className="mt-3 flex justify-center gap-4 text-sm text-crater"><Link href="/login/phone" className="underline underline-offset-2">{t("phoneLogin")}</Link><Link href="/forgot-password" className="underline underline-offset-2">{t("forgotPassword")}</Link></div>}
          <p className="mt-6 text-center text-sm text-muted">
            {t(mode === "login" ? "noAccount" : "hasAccount")} {" "}
            <Link className="underline transition-colors duration-200 hover:text-ink" href={mode === "login" ? "/signup" : "/login"}>{t(mode === "login" ? "signup" : "login")}</Link>
          </p>
        </form>
      </div>
    </main>
  );
}
