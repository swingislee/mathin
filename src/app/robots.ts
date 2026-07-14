import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/seo";

/** 不进索引的板块（doc15 §2.3）：受保护后台，以及挂着未成年人姓名与作品的笔记板块。
 *  排行榜不在此列——它用页面级 noindex，爬虫得先读到页面才看得见那条 meta。 */
const closedSections = ["dashboard", "classroom", "whiteboard", "notebook", "login", "signup"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          ...routing.locales.flatMap((l) => closedSections.map((s) => `/${l}/${s}`)),
          "/api/",
          // 纯净嵌入路由的意义是被外站 iframe，不是自己被收录
          "/embed/",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
