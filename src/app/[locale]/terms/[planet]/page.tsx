import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import type { IslandCard } from "@/features/terms/three/planet-scene";
import { IslandProgressList, PlanetView } from "@/features/terms/three/views";
import { getPlanet, termPlanets } from "@/features/terms/universe";
import { getTermsByIsland } from "@/lib/content";
import { Link } from "@/i18n/navigation";

export function generateStaticParams() {
  return termPlanets.map((p) => ({ planet: p.id }));
}

/** 星球是封闭清单，未知 id 由路由层 404（真状态码），不进入渲染。 */
export const dynamicParams = false;

/** 星球聚焦页：完整球体轮廓 + 3 个岛屿（设计文档 §9） */
export default async function PlanetPage({ params }: { params: Promise<{ locale: string; planet: string }> }) {
  const { locale, planet: planetId } = await params;
  setRequestLocale(locale);
  const planet = getPlanet(planetId);
  if (!planet) notFound();
  const t = await getTranslations("termsUniverse");

  const islands = planet.islands.map((isl) => {
    const nodes = getTermsByIsland(planet.id, isl.id);
    return {
      id: isl.id,
      name: t(`islandNames.${planet.id}.${isl.id}.name`),
      desc: t(`islandNames.${planet.id}.${isl.id}.desc`),
      slugs: nodes.map((n) => n.slug),
      card: {
        id: isl.id,
        name: t(`islandNames.${planet.id}.${isl.id}.name`),
        desc: t(`islandNames.${planet.id}.${isl.id}.desc`),
        countLine: nodes.length > 0 ? t("conceptCount", { n: nodes.length }) : t("empty"),
        enterLine: t("enterIsland"),
      } satisfies IslandCard,
    };
  });

  return (
    <div className="night">
      <main className="relative flex h-screen min-h-[600px] flex-col overflow-hidden" style={{ background: "#121524" }}>
        <div className="relative z-10">
          <SiteHeader />
        </div>
        <div className="relative min-h-0 flex-1">
          <PlanetView planet={planet} islands={islands.map((i) => i.card)} />
          {/* 信息卡：桌面居左纵排，移动端沉底横排滑动 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex gap-3 overflow-x-auto px-4 pb-1 md:inset-x-auto md:inset-y-0 md:bottom-auto md:left-4 md:w-full md:max-w-xs md:flex-col md:justify-center md:gap-6 md:overflow-visible md:p-8">
            <div className="pointer-events-auto min-w-[240px] shrink-0 rounded-2xl border border-line/60 bg-card/80 p-4 backdrop-blur-sm md:min-w-0 md:p-5">
              <Link href="/terms" className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors duration-200 hover:text-ink">
                <ArrowLeft size={13} />
                {t("backToGalaxy")}
              </Link>
              <h1 className="mt-2 font-display text-xl text-ink md:mt-3 md:text-3xl">{t(`planets.${planet.id}.name`)}</h1>
              <p className="mt-1.5 text-xs leading-6 text-muted md:mt-2 md:text-sm">{t(`planets.${planet.id}.tag`)}</p>
            </div>
            <div className="pointer-events-auto min-w-[240px] shrink-0 rounded-2xl border border-line/60 bg-card/80 p-4 backdrop-blur-sm md:min-w-0 md:p-5">
              <p className="mb-2.5 text-xs tracking-widest text-muted md:mb-3">{t("progress")}</p>
              <IslandProgressList islands={islands.map(({ id, name, slugs }) => ({ id, name, slugs }))} litTemplate={t("litCount", { n: "{n}", total: "{total}" })} />
            </div>
          </div>
          <p className="pointer-events-none absolute bottom-4 left-1/2 z-10 hidden -translate-x-1/2 text-xs text-muted md:block">{t("rotateHint")}</p>
        </div>
      </main>
    </div>
  );
}
