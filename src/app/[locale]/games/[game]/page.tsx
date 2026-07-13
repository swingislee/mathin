import { ArrowLeft, Trophy } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GameMatch } from "@/features/games/match";
import { getGame } from "@/features/games/registry";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTermsForGame } from "@/lib/content";

export default async function GamePage({ params }: { params: Promise<{ locale: string; game: string }> }) {
  const { locale, game } = await params;
  setRequestLocale(locale);
  const def = getGame(game);
  if (!def) notFound();
  const t = await getTranslations("games");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const relatedTerms = getTermsForGame(game);
  return (
    <main data-planet="king" className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 pb-16">
      <div className="flex items-center gap-3 py-4">
        <Link href="/games" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors duration-200 hover:text-ink">
          <ArrowLeft size={15} />
          {t("backToGames")}
        </Link>
        <span aria-hidden className="h-4 w-px bg-line" />
        <span className="font-serif text-xs text-(--p-accent)">Nº {String(def.no).padStart(2, "0")}</span>
        <span className="text-sm font-medium">{t(`items.${game}.name`)}</span>
        <Link
          href={`/games/${game}/ranks`}
          className="ml-auto inline-flex items-center gap-1.5 text-sm text-muted transition-colors duration-200 hover:text-ink"
        >
          <Trophy size={14} />
          {t("ranks")}
        </Link>
      </div>
      <div className="mt-4 flex-1">
        <GameMatch gameId={game} loggedIn={Boolean(user)} />
        {/* 底部说明折叠区（教学功能，docs/plan/02-3.2） */}
        <details className="mx-auto mt-8 max-w-2xl rounded-xl border border-(--p-line) bg-(--p-wash) px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">{t("rules")}</summary>
          <p className="mt-2 leading-6 text-muted">{t(`items.${game}.rules`)}</p>
        </details>
        {relatedTerms.length > 0 && <div className="mx-auto mt-4 max-w-2xl text-sm text-muted">{t("relatedTerms")}{relatedTerms.map(term=><Link key={term.uid} href={`/terms/concepts/${term.slug}`} className="ml-2 underline underline-offset-2 hover:text-ink">{term.title}</Link>)}</div>}
      </div>
    </main>
  );
}
