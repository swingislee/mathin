import type { MetadataRoute } from "next";
import { games } from "@/features/games/registry";
import { termPlanets } from "@/features/terms/universe";
import { tools } from "@/features/tools/registry";
import { routing } from "@/i18n/routing";
import { getMinds, getTerms, mindContentLocales, termContentLocales } from "@/lib/content";
import { absoluteUrl } from "@/lib/seo";

/** hreflang 键与 buildMetadata 一致；中文带地区。 */
const HREFLANG: Record<string, string> = { zh: "zh-CN", en: "en" };

/** 两语齐全的页面：一条记录 + 语言备份，交叉声明为同一内容的两个语言版本。 */
function bilingual(path: string): MetadataRoute.Sitemap[number] {
  return {
    url: absoluteUrl(routing.defaultLocale, path),
    alternates: {
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [HREFLANG[l], absoluteUrl(l, path)])),
        "x-default": absoluteUrl(routing.defaultLocale, path),
      },
    },
  };
}

/** 内容页按**这一篇实际有几种语言**登记：有英文正文才写语言备份，否则只登记中文地址，
 *  不宣称有 en 版本（doc15 §10.3）。补一篇英文 MDX，这里自动跟着变。 */
function byAvailability(path: string, locales: readonly string[]): MetadataRoute.Sitemap[number] {
  return locales.includes("en") ? bilingual(path) : { url: absoluteUrl(routing.defaultLocale, path) };
}

export default function sitemap(): MetadataRoute.Sitemap {
  const sections = ["", "/story", "/terms", "/terms/graph", "/minds", "/games", "/tools", "/privacy", "/children-privacy"];
  const planets = termPlanets.flatMap((p) => [
    `/terms/${p.id}`,
    ...p.islands.map((i) => `/terms/${p.id}/${i.id}`),
  ]);
  const registries = [
    ...games.map((g) => `/games/${g.id}`),
    ...tools.map((t) => `/tools/${t.id}`),
  ];

  return [
    ...[...sections, ...planets, ...registries].map(bilingual),
    ...getTerms().map((t) => byAvailability(`/terms/concepts/${t.slug}`, termContentLocales(t.slug))),
    ...getMinds().map((m) => byAvailability(`/minds/${m.slug}`, mindContentLocales(m.slug))),
  ];
}
