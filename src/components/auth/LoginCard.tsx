"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { submitLogin } from "@/app/[locale]/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "@/i18n/navigation";
import { WechatLoginButton } from "@/features/wechat/WechatLoginButton";
import { wechatError as parseWechatError } from "@/features/wechat/contract";
import type { LoginState } from "./login-contract";
import { EmailLoginInput, PhoneLoginInput } from "./LoginIdentifierFields";
import { emailInputIdentifier, phoneInputIdentifier } from "./login-identifier-input";

export type LoginCardProps = {
  locale: string;
  wechatAvailable: boolean;
  next?: string;
  error?: string;
  wechatError?: string;
  dialog?: boolean;
  onSuccess?: () => void;
  onNavigate?: () => void;
};

/** 页面与浮窗共用一份表单；外层 Card / Dialog 各自提供唯一表面。 */
export function LoginCard({ locale, wechatAvailable, next, error, wechatError, dialog = false, onSuccess, onNavigate }: LoginCardProps) {
  const t = useTranslations("auth");
  const wechat = useTranslations("wechat");
  const id = useId();
  const [method, setMethod] = useState("email");
  const [email, setEmail] = useState({ localPart: "", domain: locale === "zh" ? "qq.com" : "gmail.com" });
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryHelp, setRecoveryHelp] = useState(false);
  const [state, action, pending] = useActionState<LoginState, FormData>(submitLogin, { ok: false });
  const Heading = dialog ? "h2" : "h1";
  const busy = pending || state.ok;
  const errorCode = state.ok ? null : state.code ?? error;
  const errorMessage = errorCode === "unavailable" ? t("serviceUnavailable") : errorCode === "locked" ? t("accountLocked") : errorCode ? t("error") : null;

  useEffect(() => { if (state.ok) onSuccess?.(); }, [state.ok, onSuccess]);

  return <div className="p-6 sm:p-8" data-login-card>
    <div className="mb-7">
      <Link href="/" onNavigate={onNavigate} className="font-display text-xl">Mathin</Link>
      <Heading className="mt-7 font-display text-3xl">{t("loginTitle")}</Heading>
    </div>

    <form action={action} autoComplete="on" aria-busy={busy}>
      <Input type="hidden" name="locale" value={locale} />
      <Input type="hidden" name="presentation" value={dialog ? "dialog" : "page"} />
      <Input type="hidden" name="username" value={method === "email" ? emailInputIdentifier(email) : phoneInputIdentifier(phone)} />
      {next ? <Input type="hidden" name="next" value={next} /> : null}
      <Tabs value={method} onValueChange={(value) => { setMethod(value); setRecoveryHelp(false); }}>
        <TabsList className="mb-5 grid h-10 w-full grid-cols-2 rounded-xl" aria-label={t("passwordMethod")}>
          <TabsTrigger value="email" disabled={busy} className="rounded-lg">{t("email")}</TabsTrigger>
          <TabsTrigger value="phone" disabled={busy} className="rounded-lg">{t("phoneNumber")}</TabsTrigger>
        </TabsList>
        <TabsContent value="email" className="mt-0"><EmailLoginInput id={`${id}-email`} disabled={busy} autoFocus={dialog} value={email} onChange={setEmail} /></TabsContent>
        <TabsContent value="phone" className="mt-0"><PhoneLoginInput id={`${id}-phone`} disabled={busy} autoFocus={dialog} value={phone} onChange={setPhone} /></TabsContent>
      </Tabs>

      <div className="mb-2 mt-5 flex items-center justify-between gap-3">
        <Label htmlFor={`${id}-password`}>{t("password")}</Label>
        {method === "email" ? <Link href="/forgot-password" onNavigate={onNavigate} className="text-xs text-muted underline-offset-4 hover:text-ink hover:underline">{t("forgotPassword")}</Link>
          : <Button type="button" variant="ghost" className="h-auto p-0 text-xs text-muted hover:underline" onClick={() => setRecoveryHelp(true)}>{t("forgotPassword")}</Button>}
      </div>
      <div className="relative">
        <Input id={`${id}-password`} name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required minLength={6} maxLength={128}
          className="h-11 rounded-full bg-transparent pl-4 pr-12" readOnly={busy} />
        <Button type="button" variant="ghost" className="absolute right-1 top-1 size-9 p-0 text-muted" onClick={() => setShowPassword(!showPassword)}
          aria-label={t(showPassword ? "hidePassword" : "showPassword")} aria-pressed={showPassword}>
          {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </Button>
      </div>
      {recoveryHelp ? <p className="mt-3 text-sm text-muted" role="status">{t("phoneRecoveryHelp")}</p> : null}
      {errorMessage ? <p className="mt-3 text-sm text-rose" role="alert">{errorMessage}</p> : null}
      <Button type="submit" size="lg" className="mt-7 w-full" disabled={busy}>
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}{t(busy ? "signingIn" : "login")}
      </Button>
    </form>

    <div className="my-5 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" /><span>{t("or")}</span><span className="h-px flex-1 bg-line" /></div>
    <div className="grid auto-cols-fr grid-flow-col gap-3" aria-label={t("otherLoginMethods")}>
      <WechatLoginButton locale={locale} next={next} available={wechatAvailable} disabled={busy} />
    </div>
    {wechatError ? <p role="alert" className="mt-3 text-sm text-rose">{wechat(`errors.${parseWechatError(wechatError)}`)}</p> : null}
    <p className="mt-6 text-center text-sm text-muted">{t("haveInvitation")} <Link href="/signup" onNavigate={onNavigate} className="text-ink underline underline-offset-4">{t("activateAccount")}</Link></p>
  </div>;
}
