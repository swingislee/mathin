import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { KnowledgeGalaxy } from "@/features/terms/galaxy";
import { layoutGalaxy } from "@/features/terms/galaxy-layout";
import { getTerms } from "@/lib/content";
import { Link } from "@/i18n/navigation";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const tu = await getTranslations({ locale, namespace: "termsUniverse" });
  return buildMetadata({ locale, path: "/terms/graph", title: tu("graphEntry"), description: tu("graphIntro") });
}

/** 完整知识图谱：高级关系视图，给教师与重度探索者（设计文档 §12），不是学习入口 */
export default async function GraphPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("terms");
  const tu = await getTranslations("termsUniverse");
  const { nodes, edges } = layoutGalaxy(getTerms(locale));
  return (
    <div className="night">
      <main className="flex min-h-screen flex-col" style={{ background: "#121524" }}>
        <SiteHeader />
        <div className="mx-auto w-full max-w-6xl flex-1 px-6 pb-14">
          <Link href="/terms" className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors duration-200 hover:text-ink">
            <ArrowLeft size={13} />
            {tu("backToGalaxy")}
          </Link>
          <h1 className="mt-4 font-display text-2xl text-ink md:text-3xl">{tu("graphEntry")}</h1>
          <p className="mt-2 text-sm text-muted">{tu("graphIntro")}</p>
          <div className="mt-8">
            <KnowledgeGalaxy
              nodes={nodes}
              edges={edges}
              legendLearned={t("galaxyLearned")}
              stageLabels={{ 1: t("stage1"), 2: t("stage2"), 3: t("stage3") }}
            />
            <p className="mt-3 text-center text-xs text-muted">{t("galaxyHint")}</p>
          </div>
        </div>
      </main>
    </div>
  );
}
