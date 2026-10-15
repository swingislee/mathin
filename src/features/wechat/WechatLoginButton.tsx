"use client";

import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { WechatLogo } from "@/components/icons/WechatLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { beginWechatLogin } from "./actions";

function WechatSubmit({ available, disabled, label }: { available: boolean; disabled: boolean; label?: string }) {
  const t = useTranslations("wechat");
  const { pending } = useFormStatus();
  const text = label ?? t("login");
  return <Button type="submit" variant="secondary" className="h-11 w-full" disabled={!available || disabled || pending}
    aria-label={text} title={available ? text : t("errors.unavailable")}>
    <WechatLogo className="size-5" />{text}
  </Button>;
}

export function WechatLoginButton({ locale, next, available, disabled = false, label }: { locale: string; next?: string; available: boolean; disabled?: boolean; label?: string }) {
  return <form action={beginWechatLogin}>
    <Input type="hidden" name="locale" value={locale} />
    {next ? <Input type="hidden" name="next" value={next} /> : null}
    <WechatSubmit available={available} disabled={disabled} label={label} />
  </form>;
}
