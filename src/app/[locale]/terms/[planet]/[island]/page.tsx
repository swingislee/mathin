import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { JsonLd } from "@/components/json-ld";
import { SiteHeader } from "@/components/site-header";
import { Star4 } from "@/components/star4";
import { PathTrail } from "@/features/terms/path-trail";
import { getIsland, getPlanet, termPlanets } from "@/features/terms/universe";
import { getTermsByIsland } from "@/lib/content";
import { Link } from "@/i18n/navigation";
import { breadcrumbJsonLd } from "@/lib/jsonld";
import { buildMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return termPlanets.flatMap((p) => p.islands.map((i) => ({ planet: p.id, island: i.id })));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; planet: string; island: string }> }): Promise<Metadata> {
  const { locale, planet, island } = await params;
  if (!getIsland(planet, island)) return {};
  const t = await getTranslations({ locale, namespace: "termsUniverse" });
  return buildMetadata({
    locale,
    path: `/terms/${planet}/${island}`,
    title: t(`islandNames.${planet}.${island}.name`),
    description: t(`islandNames.${planet}.${island}.desc`),
  });
}

/** 岛屿是封闭清单，未知 id 由路由层 404（真状态码），不进入渲染。 */
export const dynamicParams = false;

/** 岛屿学习路径页：具体知识点只在这里展开（设计文档 §10） */
export default async function IslandPage({ params }: { params: Promise<{ locale: string; planet: string; island: string }> }) {
  const { locale, planet: planetId, island: islandId } = await params;
  setRequestLocale(locale);
  const planet = getPlanet(planetId);
  const island = planet ? getIsland(planetId, islandId) : undefined;
  if (!planet || !island) notFound();
  const t = await getTranslations("termsUniverse");
  const nav = await getTranslations("nav");
  const common = await getTranslations("common");
  const nodes = getTermsByIsland(locale, planet.id, island.id);

  return (
    <main data-planet="geographer" className="flex min-h-screen flex-col">
      <JsonLd
        data={breadcrumbJsonLd(locale, [
          { name: common("home"), path: "" },
          { name: nav("terms"), path: "/terms" },
          { name: t(`planets.${planet.id}.name`), path: `/terms/${planet.id}` },
          { name: t(`islandNames.${planet.id}.${island.id}.name`) },
        ])}
      />
      <SiteHeader />
      <div className="mx-auto w-full max-w-3xl flex-1 px-6 pb-16">
        <nav className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Link href="/" className="transition-colors duration-200 hover:text-ink">{common("home")}</Link>
          <span aria-hidden>/</span>
          <Link href="/terms" className="transition-colors duration-200 hover:text-ink">{nav("terms")}</Link>
          <span aria-hidden>/</span>
          <Link href={`/terms/${planet.id}`} className="transition-colors duration-200 hover:text-ink">{t(`planets.${planet.id}.name`)}</Link>
          <span aria-hidden>/</span>
          <span className="text-ink">{t(`islandNames.${planet.id}.${island.id}.name`)}</span>
        </nav>

        <h1 className="mt-8 font-display text-3xl md:text-4xl">{t(`islandNames.${planet.id}.${island.id}.name`)}</h1>
        <p className="mt-3 leading-7 text-muted">{t(`islandNames.${planet.id}.${island.id}.desc`)}</p>
        <div aria-hidden className="mt-4 h-0.5 w-8 rounded-full bg-[var(--p-accent)]" />

        <div className="mt-12">
          {nodes.length > 0 ? (
            <PathTrail
              nodes={nodes.map((n) => ({ slug: n.slug, title: n.title, summary: n.summary, no: n.no }))}
              currentLabel={t("continueHere")}
            />
          ) : (
            <EmptyState message={t("empty")} />
          )}
        </div>
      </div>
      <footer className="flex items-center justify-center gap-2 pb-8 text-sm text-muted">
        <Star4 size={12} />
        <span>Mathin</span>
      </footer>
    </main>
  );
}
