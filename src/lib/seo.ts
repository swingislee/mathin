import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

type Locale = (typeof routing.locales)[number];

export const SITE_NAME = "Mathin";

/** 站点绝对源。canonical / hreflang / sitemap 必须是绝对地址，
 *  开发机的局域网地址只在本地生效，缺省一律回落正式域名。 */
export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://mathin.club").replace(/\/+$/, "");

/** BCP 47（hreflang 用）：中文带地区，和 lib/theme 的 htmlLang 保持一致 */
const HREFLANG: Record<Locale, string> = { zh: "zh-CN", en: "en" };
/** OpenGraph 的 locale 用下划线格式，且要求带地区 */
const OG_LOCALE: Record<Locale, string> = { zh: "zh_CN", en: "en_US" };

const OG_IMAGE = { url: "/Main.png", width: 1521, height: 1521, alt: SITE_NAME };

function asLocale(value: string): Locale {
  return routing.locales.includes(value as Locale) ? (value as Locale) : routing.defaultLocale;
}

/** locale + 站内路径 → 绝对 URL。path 以 "/" 开头，首页传 ""。 */
export function absoluteUrl(locale: string, path = ""): string {
  return `${siteUrl}/${locale}${path}`;
}

export interface BuildMetadataArgs {
  locale: string;
  /** locale 段之后的路径，如 "/terms/concepts/percent"；首页传 ""。 */
  path?: string;
  title: string;
  description?: string;
  /** 首页等不该被套上 "%s · Mathin" 模板的页面。 */
  titleIsAbsolute?: boolean;
  /**
   * 该页**正文**真实存在的语言，默认两语齐全（版面文案来自 messages 的页面即是）。
   * 正文只有中文的内容页传 ["zh"]：此时 /en 地址只是中文页的重复品，canonical 指回中文版、
   * 且不产出 hreflang——doc15 §10.3：英文内容不存在却宣称有 en 版本，比没有 hreflang 更伤。
   * P4G-4 打通 content/{zh,en} 后，按篇传入真实的语言集合即可。
   */
  contentLocales?: readonly string[];
  type?: "website" | "article";
  /** 公开可访问、但不该进搜索索引的页面（如带真实姓名的排行榜）。 */
  noIndex?: boolean;
}

export function buildMetadata({
  locale,
  path = "",
  title,
  description,
  titleIsAbsolute = false,
  contentLocales = routing.locales,
  type = "website",
  noIndex = false,
}: BuildMetadataArgs): Metadata {
  const available = routing.locales.filter((l) => contentLocales.includes(l));
  const bilingual = available.length > 1;
  // 单语页只有一个真实版本，另一语言的地址全部 canonical 回它
  const canonical = absoluteUrl(bilingual ? asLocale(locale) : (available[0] ?? routing.defaultLocale), path);
  const languages = bilingual
    ? {
        ...Object.fromEntries(available.map((l) => [HREFLANG[l], absoluteUrl(l, path)])),
        "x-default": absoluteUrl(routing.defaultLocale, path),
      }
    : undefined;

  return {
    title: titleIsAbsolute ? { absolute: title } : title,
    description,
    robots: noIndex ? { index: false, follow: true } : undefined,
    alternates: { canonical, languages },
    openGraph: {
      type,
      siteName: SITE_NAME,
      locale: OG_LOCALE[asLocale(locale)],
      title,
      description,
      url: canonical,
      images: [OG_IMAGE],
    },
    twitter: { card: "summary", title, description, images: [OG_IMAGE.url] },
  };
}
