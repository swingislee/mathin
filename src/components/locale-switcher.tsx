"use client";

import { Languages } from "lucide-react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const next = locale === "zh" ? "en" : "zh";
  return <button type="button" aria-label="切换语言" onClick={() => router.replace(pathname, { locale: next })} className="flex items-center gap-1.5 rounded-full border bg-[var(--card)] px-3 py-2 text-sm transition hover:-translate-y-0.5"><Languages size={17} /><span>{next.toUpperCase()}</span></button>;
}
