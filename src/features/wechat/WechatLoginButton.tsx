import { getTranslations } from "next-intl/server";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { beginWechatLogin } from "./actions";
import { getWechatConfig } from "./config";

export async function WechatLoginButton({ locale, next }: { locale: string; next?: string }) {
  const t = await getTranslations("wechat");
  const available = Boolean(getWechatConfig());
  return <div className="mt-5 w-full border-t border-line pt-5">
    <form action={beginWechatLogin}>
      <Input type="hidden" name="locale" value={locale} />
      {next ? <Input type="hidden" name="next" value={next} /> : null}
      <Button type="submit" variant="secondary" className="w-full" disabled={!available}><MessageCircle className="size-4" aria-hidden />{t("login")}</Button>
    </form>
    <p className="mt-2 text-xs leading-5 text-muted">{available ? t("loginNotice") : t("disabled")}</p>
    <Link href="/privacy" className="text-xs underline underline-offset-2">{t("privacy")}</Link>
  </div>;
}
