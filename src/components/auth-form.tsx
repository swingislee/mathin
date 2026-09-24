import { getTranslations } from "next-intl/server";
import { signup } from "@/app/[locale]/(auth)/actions";
import { Star4 } from "@/components/star4";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { LoginCard } from "@/components/auth/LoginCard";
import { getWechatConfig } from "@/features/wechat/config";

export async function AuthForm({ mode, locale, error, next, wechatError }: { mode: "login" | "signup"; locale: string; error?: string; next?: string; wechatError?: string }) {
  const t = await getTranslations("auth");
  const common = await getTranslations("common");
  if (mode === "login") {
    // 用户指定的独立登录卡；页面与浮窗使用同一组字段和 OAuth 按钮。
    return <main className="grid min-h-dvh place-items-center px-4 py-10 sm:px-6">
      <Card className="w-full max-w-[26rem] overflow-hidden"><LoginCard locale={locale} next={next} error={error} wechatError={wechatError} wechatAvailable={Boolean(getWechatConfig())} /></Card>
    </main>;
  }
  const errorMessage = error === "invite"
    ? t("invalidInvite")
    : error === "validation"
      ? t("invalidRegistration")
      : error === "method"
        ? t("authMethodUnavailable")
        : error === "locked"
          ? t("accountLocked")
          : error
            ? t("error")
            : null;

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-16">
      <div className="flex w-full max-w-md flex-col items-center">
        <Star4 size={24} className="mb-6" />
        <form action={signup} autoComplete="on" className="w-full rounded-[2rem] border bg-card p-8 shadow-sm">
          <Link href="/" className="font-display text-xl">Mathin</Link>
          <h1 className="mb-7 mt-7 font-display text-3xl">{t("signupTitle")}</h1>
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

          <Label className="mb-2 block" htmlFor="username">{t("identifier")}</Label>
          <Input className="h-11 rounded-full bg-transparent px-4" id="username" name="username" type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder={t("identifierPlaceholder")} />
          <p className="mb-5 mt-2 text-xs leading-5 text-muted">{t("signupIdentifierHint")}</p>
          <Label className="mb-2 block" htmlFor="password">{t("password")}</Label>
          <Input className="h-11 rounded-full bg-transparent px-4" id="password" name="password" type="password" minLength={8} maxLength={128} required autoComplete="new-password" />

          {mode === "signup" && (
            <>
              <Label className="mb-2 mt-5 block" htmlFor="passwordConfirm">{t("passwordConfirm")}</Label>
              <Input className="h-11 rounded-full bg-transparent px-4" id="passwordConfirm" name="passwordConfirm" type="password" minLength={8} maxLength={128} required autoComplete="new-password" />
            </>
          )}

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
          <p className="mt-6 text-center text-sm text-muted">
            {t("hasAccount")} {" "}
            <Link className="underline transition-colors duration-200 hover:text-ink" href="/login">{t("login")}</Link>
          </p>
        </form>
      </div>
    </main>
  );
}
