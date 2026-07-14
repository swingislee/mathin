import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import type { PlanetLabel } from "@/features/terms/three/galaxy-scene";
import { GalaxyView } from "@/features/terms/three/views";
import { termPlanets } from "@/features/terms/universe";
import { getTerms } from "@/lib/content";
import { Link } from "@/i18n/navigation";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const nav = await getTranslations({ locale, namespace: "nav" });
  const t = await getTranslations({ locale, namespace: "terms" });
  return buildMetadata({ locale, path: "/terms", title: nav("terms"), description: t("intro") });
}

/** 知识星系首页：只展示星球，不展示知识点（设计文档 §3.2/§8） */
export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("termsUniverse");
  const nav = await getTranslations("nav");

  const labels: Record<string, PlanetLabel> = Object.fromEntries(
    termPlanets.map((p) => [
      p.id,
      { id: p.id, name: t(`planets.${p.id}.name`), tag: t(`planets.${p.id}.tag`), enter: t("enter"), recommendedLabel: t("recommended") },
    ]),
  );
  const planetSlugs: Record<string, string[]> = {};
  for (const term of getTerms(locale)) {
    (planetSlugs[term.planet] ??= []).push(term.slug);
  }

  return (
    <div className="night">
      <main className="relative flex h-screen min-h-[560px] flex-col overflow-hidden" style={{ background: "#121524" }}>
        <div className="relative z-10">
          <SiteHeader />
        </div>
        {/* 移动端：宇宙比屏幕大，横向滑动巡航；桌面端正常填充 */}
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden md:overflow-visible">
          <div className="relative h-full min-w-[920px] md:min-w-0">
            <GalaxyView planets={termPlanets} labels={labels} planetSlugs={planetSlugs} />
          </div>
        </div>
        {/* 覆盖层文案 */}
        <div className="pointer-events-none absolute left-6 top-20 z-10 md:left-10">
          <h1 className="font-display text-2xl text-ink md:text-3xl">{nav("terms")}</h1>
          <p className="mt-1.5 text-xs text-muted md:text-sm">{t("hint")}</p>
        </div>
        <div className="absolute bottom-4 right-6 z-10 md:right-10">
          <Link href="/terms/graph" className="text-xs text-muted transition-colors duration-200 hover:text-ink">
            ✦ {t("graphEntry")}
          </Link>
        </div>
      </main>
    </div>
  );
}
