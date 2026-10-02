import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { ThemePageIdentity } from "@/components/theme-page-identity";
import { formatMs } from "@/features/games/format";
import { GameParade } from "@/features/games/hall/GameParade";
import type { GameParadeCard } from "@/features/games/hall/parade-contract";
import { games } from "@/features/games/registry";
import type { Difficulty } from "@/features/games/types";
import { buildMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const nav = await getTranslations({ locale, namespace: "nav" });
  const t = await getTranslations({ locale, namespace: "games" });
  return buildMetadata({ locale, path: "/games", title: nav("games"), description: t("intro") });
}

/** 按游戏与难度取当前玩家的最佳用时；未登录返回空战绩。 */
async function fetchRecords() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const bests: Record<string, Partial<Record<Difficulty, number>>> = {};
  if (!user) return { signedIn: false, bests };
  const { data } = await supabase
    .from("game_scores")
    .select("game_id, difficulty, duration_ms")
    .eq("user_id", user.id)
    .returns<{ game_id: string; difficulty: Difficulty; duration_ms: number }[]>();
  for (const row of data ?? []) {
    const game = (bests[row.game_id] ??= {});
    const best = game[row.difficulty];
    if (best === undefined || row.duration_ms < best) game[row.difficulty] = row.duration_ms;
  }
  return { signedIn: true, bests };
}

export default async function GamesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("games");
  const nav = await getTranslations("nav");
  const { signedIn, bests } = await fetchRecords();

  const cards: GameParadeCard[] = games.map(({ id, no, suit, crowns, icon: Icon, difficulties }, index) => ({
    id,
    no,
    suit,
    suitLabel: t(`parade.suits.${suit}`),
    crowns,
    icon: <Icon strokeWidth={1.6} aria-hidden />,
    name: t(`items.${id}.name`),
    desc: t(`items.${id}.desc`),
    position: t("parade.position", { index: index + 1, total: games.length }),
    records: difficulties.map((difficulty) => {
      const ms = bests[id]?.[difficulty];
      return { difficulty, label: t(`difficulty.${difficulty}`), best: ms === undefined ? null : formatMs(ms) };
    }),
  }));

  return (
    <div className="scene-day scene-adaptive scene-games min-h-dvh">
      <SiteHeader />
      <main className="game-hall text-[var(--scene-ink)]">
        <div className="scene-illustration" aria-hidden />
        <div className="scene-illustration-wash" aria-hidden />

        <ThemePageIdentity
          sectionName={nav("games")}
          planetName={nav("planetNames.games")}
          description={t("intro")}
          tone="games"
        />

        <GameParade
          cards={cards}
          signedIn={signedIn}
          labels={{
            region: t("parade.label"),
            slide: t("parade.slide"),
            prev: t("parade.prev"),
            next: t("parade.next"),
            flip: t("parade.flip"),
            flipBack: t("parade.flipBack"),
            records: t("parade.records"),
            noRecord: t("parade.noRecord"),
            start: t("start"),
            ranks: t("ranks"),
            difficultyLabel: t("difficultyLabel"),
            loginToRank: t("loginToRank"),
          }}
        />
      </main>
    </div>
  );
}
