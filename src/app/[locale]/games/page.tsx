import { Crown } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { SectionShell } from "@/components/section-shell";
import { Star4 } from "@/components/star4";
import { buttonVariants } from "@/components/ui/button";
import { formatMs } from "@/features/games/format";
import { games } from "@/features/games/registry";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

/** 登录用户在每个游戏的最好用时（跨难度取最小） */
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
  const common = await getTranslations("common");
  const bests = await fetchPersonalBests();
  return (
    <SectionShell section="games" wide intro={t("intro")}>
      {games.length === 0 ? (
        <EmptyState message={common("comingSoon")} />
      ) : (
        // 谒见厅：卡片网格规整对称（docs/plan/05-3.2）
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map(({ id, no, crowns, icon: Icon }) => (
            <div key={id} className="relative flex flex-col rounded-2xl border bg-card p-5 transition duration-200 hover:-translate-y-0.5">
              {/* 御赐勋章：个人最好成绩挂右上角 */}
              {id in bests && (
                <span className="absolute -right-2 -top-2 inline-flex items-center gap-1 rounded-full border border-(--p-accent-2) bg-card px-2 py-0.5 font-serif text-xs tabular-nums">
                  <Star4 size={10} className="text-(--medal-1)" />
                  {formatMs(bests[id])}
                </span>
              )}
              <div className="flex items-center justify-between">
                {/* 纹章盾形徽记 */}
                <div className="flex size-12 items-center justify-center rounded-t-xl rounded-b-[50%_60%] border border-(--p-line) bg-(--p-wash) text-(--p-accent)">
                  <Icon size={22} />
                </div>
                <span className="font-serif text-xs text-(--p-accent)">Nº {String(no).padStart(2, "0")}</span>
              </div>
              <p className="mt-4 font-medium">{t(`items.${id}.name`)}</p>
              <p className="mt-1 flex-1 text-xs leading-5 text-muted">{t(`items.${id}.desc`)}</p>
              <div className="mt-4 flex items-center justify-between">
                <span className="flex gap-0.5 text-(--p-accent-2)" aria-label={t("difficultyLabel")}>
                  {Array.from({ length: crowns }, (_, i) => <Crown key={i} size={14} fill="currentColor" />)}
                </span>
                <span className="flex items-center gap-2">
                  <Link href={`/games/${id}/ranks`} className="text-xs text-muted transition-colors duration-200 hover:text-ink">
                    {t("ranks")}
                  </Link>
                  <Link
                    href={`/games/${id}`}
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "border-(--p-accent-2)")}
                  >
                    {t("start")}
                  </Link>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}
