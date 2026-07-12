"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations("common");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const next = locale === "zh" ? "en" : "zh";
  const href = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;
  return <button type="button" aria-label={t("switchLanguage")} onClick={() => router.replace(href, { locale: next })} className="flex items-center gap-1.5 rounded-full border bg-[var(--card)] px-3 py-2 text-sm transition hover:-translate-y-0.5"><Languages size={17} /><span>{next.toUpperCase()}</span></button>;
}
