import type { Metadata } from "next";
import Image from "next/image";
import { Crown } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { Star4 } from "@/components/star4";
import { ThemePageIdentity } from "@/components/theme-page-identity";
import { buttonVariants } from "@/components/ui/button";
import { formatMs } from "@/features/games/format";
import { games } from "@/features/games/registry";
import { Link } from "@/i18n/navigation";
import { buildMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const nav = await getTranslations({ locale, namespace: "nav" });
  const t = await getTranslations({ locale, namespace: "games" });
  return buildMetadata({ locale, path: "/games", title: nav("games"), description: t("intro") });
}

async function fetchPersonalBests(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const { data } = await supabase
    .from("game_scores")
    .select("game_id, duration_ms")
    .eq("user_id", user.id)
    .returns<{ game_id: string; duration_ms: number }[]>();
  const best: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!(row.game_id in best) || row.duration_ms < best[row.game_id]) best[row.game_id] = row.duration_ms;
  }
  return best;
}

export default async function GamesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("games");
  const nav = await getTranslations("nav");
  const bests = await fetchPersonalBests();

  return (
    <div className="scene-day min-h-dvh bg-[#f2e9d7]">
      <SiteHeader />
      <main className="relative min-h-[980px] overflow-hidden text-[#44372d] md:h-dvh md:min-h-[650px]">
        <Image
          src="/illustrations/games-royal-hall.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#fffaf0]/20 via-transparent to-[#3e1515]/10" />

        <ThemePageIdentity
          sectionName={nav("games")}
          planetName={nav("planetNames.games")}
          description={t("intro")}
          tone="games"
        />

        <section className="relative z-10 grid gap-5 px-6 pb-20 pt-64 md:absolute md:inset-x-[7%] md:top-[30%] md:grid-cols-3 md:p-0 xl:inset-x-[12%]" aria-label={nav("games")}>
          {games.map(({ id, no, crowns, icon: Icon }, index) => (
            <article
              key={id}
              className="scene-enter group relative mx-auto flex min-h-[330px] w-full max-w-[300px] flex-col rounded-t-[5rem] rounded-b-2xl border border-[#b98b50] bg-[#fff9eb]/92 px-5 pb-5 pt-9 text-center shadow-[0_20px_45px_rgba(80,35,22,0.2)] ring-1 ring-inset ring-[#dfc08a]/60 backdrop-blur-[2px] transition duration-300 hover:-translate-y-2"
              style={{ animationDelay: `${120 + index * 120}ms` }}
            >
              {id in bests && (
                <span className="absolute -right-2 top-5 inline-flex items-center gap-1 rounded-full border border-[#ba8b4e] bg-[#fff9eb] px-2 py-1 text-xs tabular-nums shadow-sm">
                  <Star4 size={10} className="text-[#bd8f30]" />
                  {formatMs(bests[id])}
                </span>
              )}
              <span className="mx-auto grid size-16 place-items-center rounded-t-2xl rounded-b-[50%_60%] border border-[#c49c68] bg-[#f5e6c9] text-[#8b3841] shadow-inner">
                <Icon size={28} strokeWidth={1.6} />
              </span>
              <span className="mt-4 text-xs tracking-[0.18em] text-[#9d7650]">Nº {String(no).padStart(2, "0")}</span>
              <h2 className="mt-2 font-display text-2xl">{t(`items.${id}.name`)}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-[#746255]">{t(`items.${id}.desc`)}</p>
              <div className="mt-4 flex items-center justify-center gap-1 text-[#b58b37]" aria-label={t("difficultyLabel")}>
                {Array.from({ length: crowns }, (_, i) => <Crown key={i} size={14} fill="currentColor" />)}
              </div>
              <div className="mt-4 flex items-center justify-center gap-3">
                <Link href={`/games/${id}/ranks`} className="text-xs text-[#756455] underline-offset-4 hover:underline">{t("ranks")}</Link>
                <Link href={`/games/${id}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "border-[#9d6547] bg-[#fff8e7]/90")}>{t("start")}</Link>
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}