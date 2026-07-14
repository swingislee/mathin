import type { MetadataRoute } from "next";
import { games } from "@/features/games/registry";
import { termPlanets } from "@/features/terms/universe";
import { tools } from "@/features/tools/registry";
import { routing } from "@/i18n/routing";
import { getMinds, getTerms } from "@/lib/content";
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

/** 正文只有中文的内容页：只登记中文地址，不宣称有 en 版本（doc15 §10.3）。
 *  P4G-4 打通 content/{zh,en} 后，写出英文正文的篇目改用 bilingual()。 */
function zhOnly(path: string): MetadataRoute.Sitemap[number] {
  return { url: absoluteUrl(routing.defaultLocale, path) };
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
    ...getTerms().map((t) => zhOnly(`/terms/concepts/${t.slug}`)),
    ...getMinds().map((m) => zhOnly(`/minds/${m.slug}`)),
  ];
}
