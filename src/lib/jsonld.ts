import type { TermEntry } from "@/lib/content";
import { SITE_NAME, absoluteUrl, siteUrl } from "@/lib/seo";

/** 站点组织信息（doc15 §2.5）。只在首页注入一次。 */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl}#organization`,
    name: SITE_NAME,
    url: siteUrl,
    logo: `${siteUrl}/Main.png`,
  };
}

export function webSiteJsonLd(locale: string, description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: absoluteUrl(locale),
    description,
    publisher: { "@id": `${siteUrl}#organization` },
  };
}

/** 面包屑的一节。最后一节（当前页）不给 path——schema.org 允许末项省略 item，
 *  这样也不必在这里重算单语页 canonical 的语言归属。 */
export interface Crumb {
  name: string;
  /** locale 段之后的路径；首页传 ""。 */
  path?: string;
}

export function breadcrumbJsonLd(locale: string, crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      ...(crumb.path === undefined ? {} : { item: absoluteUrl(locale, crumb.path) }),
    })),
  };
}

/** 概念页的 LearningResource：教什么（teaches）、给谁（educationalLevel）、先修什么。
 *  正文目前只有中文，inLanguage 因此固定 zh-CN（与 canonical 指向中文页一致，见 seo.ts）。 */
export function learningResourceJsonLd(
  term: TermEntry,
  options: { url: string; stageLabel: string; prerequisites: string[] },
) {
  return {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    name: term.title,
    url: options.url,
    description: term.summary,
    inLanguage: "zh-CN",
    learningResourceType: "concept",
    teaches: term.title,
    educationalLevel: options.stageLabel,
    ...(options.prerequisites.length > 0 ? { competencyRequired: options.prerequisites } : {}),
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: siteUrl },
    publisher: { "@id": `${siteUrl}#organization` },
  };
}
