import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { ThemePageIdentity } from "@/components/theme-page-identity";
import { tools } from "@/features/tools/registry";
import { toolThumbs } from "@/features/tools/thumbs";
import { Link } from "@/i18n/navigation";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const nav = await getTranslations({ locale, namespace: "nav" });
  const t = await getTranslations({ locale, namespace: "tools" });
  return buildMetadata({ locale, path: "/tools", title: nav("tools"), description: t("intro") });
}

export default async function ToolsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tools");
  const nav = await getTranslations("nav");

  return (
    <div className="scene-day scene-adaptive scene-tools min-h-dvh" data-planet="businessman">
      <SiteHeader />
      <main className="relative min-h-[920px] overflow-hidden text-[var(--scene-ink)] md:h-dvh md:min-h-[650px]">
        <div className="scene-illustration" aria-hidden />
        <div className="scene-illustration-wash" aria-hidden />

        <ThemePageIdentity
          sectionName={nav("tools")}
          planetName={nav("planetNames.tools")}
          description={t("intro")}
          tone="tools"
        />

        <section className="relative z-10 grid gap-5 px-6 pb-20 pt-72 sm:grid-cols-2 md:absolute md:inset-x-[27%] md:top-[29%] md:p-0" aria-label={nav("tools")}>
          {tools.map(({ id, no }, index) => (
            <Link
              key={id}
              href={`/tools/${id}`}
              className="scene-enter group mx-auto w-full max-w-[300px] rounded-2xl border border-[#b88e59]/70 bg-[#fffaf0]/90 p-3 text-[#473827] shadow-[0_15px_38px_rgba(7,11,25,0.26)] backdrop-blur-[2px] transition duration-300 hover:-translate-y-2"
              style={{ animationDelay: `${140 + index * 130}ms` }}
            >
              <div className="relative aspect-[5/3] overflow-hidden rounded-xl border border-[#c9a87b] bg-[#f5ead5]">
                {toolThumbs[id]}
                <span className="absolute right-2 top-1.5 text-xs tracking-[0.12em] text-[#8d6a43]">Nº {String(no).padStart(2, "0")}</span>
              </div>
              <div className="flex items-start gap-3 px-1 pb-1 pt-3">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg">{t(`items.${id}.name`)}</h2>
                  <p className="mt-1 text-xs leading-5 text-[#75634f]">{t(`items.${id}.desc`)}</p>
                </div>
                <ArrowUpRight size={17} className="mt-1 shrink-0 text-[#866647] transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
              </div>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}