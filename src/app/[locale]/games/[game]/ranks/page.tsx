import type { Metadata } from "next";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Crown } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Star4 } from "@/components/star4";
import { formatMs } from "@/features/games/format";
import { getGame } from "@/features/games/registry";
import type { Difficulty } from "@/features/games/types";
import { Link } from "@/i18n/navigation";
import { buildMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

/** 榜单挂着真实姓名（多为未成年人），公开可看但不进搜索索引。 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string; game: string }> }): Promise<Metadata> {
  const { locale, game } = await params;
  if (!getGame(game)) return {};
  const t = await getTranslations({ locale, namespace: "games" });
  return buildMetadata({
    locale,
    path: `/games/${game}/ranks`,
    title: `${t(`items.${game}.name`)} · ${t("ranks")}`,
    noIndex: true,
  });
}

// Tailwind 只识别字面量类名，勋章色不能运行时拼接
const medalClasses = ["text-(--medal-1)", "text-(--medal-2)", "text-(--medal-3)"];

interface LeaderboardRow {
  user_id: string;
  display_name: string;
  duration_ms: number;
  created_at: string;
}

export default async function RanksPage({ params, searchParams }: {
  params: Promise<{ locale: string; game: string }>;
  searchParams: Promise<{ difficulty?: string }>;
}) {
  const { locale, game } = await params;
  setRequestLocale(locale);
  const def = getGame(game);
  if (!def) notFound();
  const sp = await searchParams;
  const difficulty: Difficulty = def.difficulties.includes(sp.difficulty as Difficulty)
    ? (sp.difficulty as Difficulty)
    : def.difficulties[0];

  const t = await getTranslations("games");
  const supabase = await createClient();
  const [{ data: rows }, { data: { user } }] = await Promise.all([
    supabase
      .from("game_leaderboard")
      .select("user_id, display_name, duration_ms, created_at")
      .eq("game_id", game)
      .eq("difficulty", difficulty)
      .order("duration_ms")
      .limit(50)
      .returns<LeaderboardRow[]>(),
    supabase.auth.getUser(),
  ]);

  return (
    <main data-planet="king" className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 pb-16">
      <div className="flex items-center gap-3 py-4">
        <Link href={`/games/${game}`} className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors duration-200 hover:text-ink">
          <ArrowLeft size={15} />
          {t(`items.${game}.name`)}
        </Link>
        <span aria-hidden className="h-4 w-px bg-line" />
        <span className="text-sm font-medium">{t("ranks")}</span>
      </div>

      {/* 难度 tab（docs/plan/02-3.2） */}
      <div className="mt-4 flex items-center gap-1.5">
        {def.difficulties.map((d, i) => (
          <Link
            key={d}
            href={`/games/${game}/ranks?difficulty=${d}`}
            className={cn(
              "flex items-center gap-1 rounded-full px-3 py-1.5 text-sm transition-colors duration-200",
              difficulty === d ? "bg-(--p-wash) text-ink" : "text-muted hover:text-ink",
            )}
          >
            {Array.from({ length: i + 1 }, (_, k) => (
              <Crown key={k} size={11} className="text-(--p-accent-2)" fill="currentColor" />
            ))}
            {t(`difficulty.${d}`)}
          </Link>
        ))}
      </div>

      {/* 御前名册：前三名金/银/铜星徽（docs/plan/05-3.2） */}
      <div className="mt-6 overflow-x-auto rounded-2xl border">
        <Table className="w-full text-sm">
          <TableHeader>
            <TableRow className="border-b bg-(--p-wash) text-left text-xs text-muted">
              <TableHead className="w-16 px-4 py-2.5 font-medium">{t("rankCol")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("playerCol")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("timeCol")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("dateCol")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((row, i) => (
              <TableRow key={row.user_id} className={cn("border-b last:border-b-0", row.user_id === user?.id && "bg-(--p-wash)")}>
                <TableCell className="px-4 py-2.5">
                  {i < 3 ? (
                    <Star4 size={16} className={medalClasses[i]} />
                  ) : (
                    <span className="tabular-nums text-muted">{i + 1}</span>
                  )}
                </TableCell>
                <TableCell className="px-4 py-2.5">{row.display_name}</TableCell>
                <TableCell className="px-4 py-2.5 font-serif tabular-nums">{formatMs(row.duration_ms)}</TableCell>
                <TableCell className="px-4 py-2.5 text-muted">
                  {new Date(row.created_at).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")}
                </TableCell>
              </TableRow>
            ))}
            {(rows ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="px-4 py-10 text-center text-muted">{t("noRanks")}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {!user && (
        <p className="mt-4 text-center text-xs text-muted">
          <Link href={`/login?next=/${locale}/games/${game}/ranks`} className="underline underline-offset-2 hover:text-ink">
            {t("loginToRank")}
          </Link>
        </p>
      )}
    </main>
  );
}
