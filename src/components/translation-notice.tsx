import { getTranslations } from "next-intl/server";
import { Languages } from "lucide-react";
import type { ContentLocale } from "@/lib/content";

/** 请求 en 但这一篇还没有英文正文时，如实说出来（docs/plan/15-§3.1：诚实优于假装）。
 *  同一事实也决定了这一篇的 canonical / hreflang / sitemap——见 lib/content 的 termContentLocales。 */
export async function TranslationNotice({ locale, contentLocale }: { locale: string; contentLocale: ContentLocale }) {
  if (locale !== "en" || contentLocale === "en") return null;
  const t = await getTranslations("common");
  return (
    <p
      lang="en"
      className="mt-6 flex items-start gap-2 rounded-xl border border-line bg-moon/20 px-4 py-3 text-sm text-muted"
    >
      <Languages aria-hidden size={15} className="mt-0.5 shrink-0" />
      {t("notTranslated")}
    </p>
  );
}
