"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { House, RotateCcw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

export function RouteErrorState({ error, reset, fullPage = false }: {
  error: Error & { digest?: string };
  reset: () => void;
  fullPage?: boolean;
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => { console.error(error); }, [error]);

  return (
    <div className={`grid ${fullPage ? "min-h-dvh" : "min-h-80 flex-1"} place-items-center p-6`}>
      <div className="max-w-md text-center" role="alert">
        <h1 className="font-display text-2xl">{t("unexpectedError")}</h1>
        <p className="mt-3 text-sm leading-6 text-muted">{t("unexpectedErrorHint")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button disabled={pending} onClick={() => startTransition(() => { router.refresh(); reset(); })}>
            <RotateCcw size={16} aria-hidden />{t("retry")}
          </Button>
          {/* 完整导航让首页脱离当前失败的路由和客户端状态。 */}
          <a href={`/${locale}`} className={buttonVariants({ variant: "secondary" })}>
            <House size={16} aria-hidden />{t("backHome")}
          </a>
        </div>
      </div>
    </div>
  );
}
