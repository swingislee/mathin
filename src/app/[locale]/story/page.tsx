import type { Metadata } from "next";
import Image from "next/image";
import { Compass, Footprints, Sparkles } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { CSSProperties } from "react";
import { SiteHeader } from "@/components/site-header";
import { ThemePageIdentity } from "@/components/theme-page-identity";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const nav = await getTranslations({ locale, namespace: "nav" });
  const t = await getTranslations({ locale, namespace: "storyScene" });
  return buildMetadata({ locale, path: "/story", title: nav("story"), description: t("intro") });
}

const chapters = [
  ["patterns", Compass, "md:left-[10%] md:top-[41%] md:-rotate-2"],
  ["measure", Footprints, "md:left-[39%] md:top-[28%] md:rotate-2"],
  ["unknown", Sparkles, "md:right-[8%] md:top-[45%] md:-rotate-1"],
] as const;

export default async function StoryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const nav = await getTranslations("nav");
  const t = await getTranslations("storyScene");

  return (
    <div className="scene-day min-h-dvh bg-[#f5ead7]">
      <SiteHeader />
      <main className="relative min-h-[980px] overflow-hidden text-[#493b2d] md:h-dvh md:min-h-[620px]">
        <Image
          src="/illustrations/story-journey.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#fff9ed]/35 via-transparent to-[#cfa66d]/15" />

        <ThemePageIdentity
          sectionName={nav("story")}
          planetName={nav("planetNames.story")}
          description={t("intro")}
          tone="story"
        />

        <section aria-label={nav("story")} className="relative z-10 grid gap-5 px-6 pb-24 pt-64 md:absolute md:inset-0 md:block md:p-0">
          {chapters.map(([key, Icon, position], index) => (
            <article
              key={key}
              className={`scene-enter scene-drift relative mx-auto w-full max-w-[280px] rounded-[1.4rem_1.1rem_1.5rem_1rem] border border-[#bfa57e]/70 bg-[#fffaf0]/88 p-5 shadow-[0_16px_38px_rgba(103,72,38,0.16)] backdrop-blur-[2px] md:absolute ${position}`}
              style={{ animationDelay: `${140 + index * 140}ms`, "--scene-rotate": `${index === 1 ? 2 : -1}deg` } as CSSProperties}
            >
              <div className="flex items-center justify-between gap-3 text-[#8f603e]">
                <span className="text-xs uppercase tracking-[0.16em]">{t(`chapters.${key}.eyebrow`)}</span>
                <Icon size={18} strokeWidth={1.6} />
              </div>
              <h2 className="mt-3 font-display text-xl leading-snug">{t(`chapters.${key}.title`)}</h2>
              <p className="mt-2 text-sm leading-6 text-[#73624d]">{t(`chapters.${key}.desc`)}</p>
            </article>
          ))}
        </section>

        <p className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap text-xs tracking-[0.16em] text-[#705b42]">
          {t("soon")}
        </p>
      </main>
    </div>
  );
}
