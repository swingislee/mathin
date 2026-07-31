import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { ThemePageIdentity } from "@/components/theme-page-identity";
import { Lamp } from "@/features/minds/lamp";
import { Link } from "@/i18n/navigation";
import { getMinds } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const nav = await getTranslations({ locale, namespace: "nav" });
  const t = await getTranslations({ locale, namespace: "mindsSection" });
  return buildMetadata({ locale, path: "/minds", title: nav("minds"), description: t("intro") });
}

export default async function MindsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("mindsSection");
  const nav = await getTranslations("nav");
  const minds = getMinds(locale);

  return (
    <div className="scene-day scene-adaptive scene-minds min-h-dvh" data-planet="lamplighter">
      <SiteHeader />
      <main className="relative min-h-[900px] overflow-hidden text-[var(--scene-ink)] md:h-dvh md:min-h-[620px]">
        <div className="scene-illustration" aria-hidden />
        <div className="scene-illustration-wash" aria-hidden />

        <ThemePageIdentity
          sectionName={nav("minds")}
          planetName={nav("planetNames.minds")}
          description={t("intro")}
          tone="minds"
        />

        <section className="relative z-10 ml-auto grid w-full max-w-xl gap-8 px-6 pb-20 pt-[27rem] md:absolute md:right-[7%] md:top-[24%] md:w-[43%] md:max-w-[620px] md:p-0" aria-label={nav("minds")}>
          <div className="absolute bottom-12 left-[2.4rem] top-[27rem] border-l border-dashed border-line/60 md:bottom-12 md:left-[1.1rem] md:top-5" aria-hidden />
          {minds.map((mind, index) => (
            <Link
              key={mind.slug}
              href={`/minds/${mind.slug}`}
              className="scene-enter group relative flex items-start gap-5 rounded-2xl px-3 py-4 transition-colors hover:bg-card/45 md:rounded-none md:px-0 md:py-5"
              style={{ animationDelay: `${160 + index * 130}ms` }}
            >
              <span className="relative z-10 grid size-9 shrink-0 place-items-center rounded-full bg-card/90 shadow-[0_0_24px_rgba(245,195,88,0.24)]">
                <Lamp slug={mind.slug} litLabel={t("lit")} unlitLabel={t("unlit")} />
              </span>
              <span className="min-w-0 flex-1 border-b border-line pb-5">
                <span className="flex items-start justify-between gap-4">
                  <span className="font-display text-xl leading-snug md:text-2xl">{mind.title}</span>
                  <ArrowUpRight className="mt-1 shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" size={18} />
                </span>
                <span className="mt-2 block text-sm leading-6 text-muted">{mind.summary}</span>
              </span>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}