"use client";

import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { beginWechatLogin } from "./actions";

function WechatSubmit({ available, disabled }: { available: boolean; disabled: boolean }) {
  const t = useTranslations("wechat");
  const { pending } = useFormStatus();
  return <Button type="submit" variant="secondary" className="h-11 w-full rounded-xl border-line" disabled={!available || disabled || pending}
    aria-label={t("login")} title={available ? t("login") : t("errors.unavailable")}>
    <MessageCircle className="size-5" aria-hidden />{t("title")}
  </Button>;
}

export function WechatLoginButton({ locale, next, available, disabled = false }: { locale: string; next?: string; available: boolean; disabled?: boolean }) {
  return <form action={beginWechatLogin}>
    <Input type="hidden" name="locale" value={locale} />
    {next ? <Input type="hidden" name="next" value={next} /> : null}
    <WechatSubmit available={available} disabled={disabled} />
  </form>;
}
