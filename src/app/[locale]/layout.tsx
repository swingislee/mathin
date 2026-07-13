import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("common");
  return <NextIntlClientProvider>
    <a href="#main-content" className="sr-only fixed left-3 top-3 z-[100] rounded-lg bg-paper px-4 py-2 text-sm text-ink shadow-lg focus:not-sr-only">{t("skipToContent")}</a>
    <div id="main-content" tabIndex={-1} className="contents">{children}</div>
  </NextIntlClientProvider>;
}
