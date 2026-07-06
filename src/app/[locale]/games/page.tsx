import { Crown } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { SectionShell } from "@/components/section-shell";
import { buttonVariants } from "@/components/ui/button";
import { games } from "@/features/games/registry";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export default async function GamesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("games");
  const common = await getTranslations("common");
  return (
    <SectionShell section="games" wide intro={t("intro")}>
      {games.length === 0 ? (
        <EmptyState message={common("comingSoon")} />
      ) : (
        // 谒见厅：卡片网格规整对称（docs/plan/05-3.2）
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map(({ id, no, crowns, icon: Icon }) => (
            <div key={id} className="flex flex-col rounded-2xl border bg-card p-5 transition duration-200 hover:-translate-y-0.5">
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
                <Link
                  href={`/games/${id}`}
                  className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "border-(--p-accent-2)")}
                >
                  {t("start")}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}
