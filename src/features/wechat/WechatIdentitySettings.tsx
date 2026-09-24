"use client";

import { useFormStatus } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { MessageCircle } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WechatAccountState } from "./contract";
import { bindWechat, unlinkWechat } from "./actions";

function Submit({ linked, disabled }: { linked: boolean; disabled: boolean }) {
  const t = useTranslations("wechat");
  const { pending } = useFormStatus();
  return <Button type="submit" variant="secondary" disabled={pending || disabled}>{t(pending ? "working" : linked ? "unlink" : "bind")}</Button>;
}

export function WechatIdentitySettings({ state }: { state: WechatAccountState }) {
  const t = useTranslations("wechat");
  const locale = useLocale();
  const available = state.linked || (state.available && state.phoneLinkingAvailable);
  return <div className="py-4">
    <div className="flex items-center gap-3">
      {state.avatarUrl ? <Image src={state.avatarUrl} width={40} height={40} alt="" className="rounded-full" referrerPolicy="no-referrer" /> : <MessageCircle className="size-5 text-crater" aria-hidden />}
      <div><p className="text-sm font-medium">{t("title")}</p><p className="text-xs text-muted">{state.linked ? `${t("linked")} · ${state.nickname || t("title")}` : t("unbound")}</p></div>
    </div>
    <p className="mt-3 text-sm text-muted">{state.linked ? t("linkedNotice") : state.pendingNickname ? t("pendingNotice", { name: state.pendingNickname }) : t("bindNotice")}</p>
    <p className="mt-2 text-xs text-muted">{t("phoneNotice")}</p>
    {available ? <form action={state.linked ? unlinkWechat : bindWechat} className="mt-4 max-w-md space-y-3">
      <Input type="hidden" name="locale" value={locale} />
      <Label htmlFor="wechat-current-password">{t("password")}</Label>
      <Input id="wechat-current-password" name="password" type="password" autoComplete="current-password" minLength={6} maxLength={128} required />
      <div className="flex items-start gap-2"><Checkbox id="wechat-confirm" name="confirm" required /><Label htmlFor="wechat-confirm" className="text-sm font-normal leading-5">{t(state.linked ? "unlinkConfirm" : "bindConfirm")}</Label></div>
      <Submit linked={state.linked} disabled={!available} />
    </form> : <p role="status" className="mt-3 text-sm text-muted">{t(state.available ? "errors.phoneCompatibility" : "disabled")}</p>}
  </div>;
}
