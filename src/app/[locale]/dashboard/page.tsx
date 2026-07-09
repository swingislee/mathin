import { Crown, School } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SectionShell } from "@/components/section-shell";
import { buttonVariants } from "@/components/ui/button";
import { listMyClassrooms } from "@/features/classroom/actions";
import { formatMs } from "@/features/games/format";
import { games } from "@/features/games/registry";
import { filterSchoolNav } from "@/features/school/nav";
import { Link } from "@/i18n/navigation";
import { getMyPerms, getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

interface BestRow {
  game_id: string;
  difficulty: string;
  duration_ms: number;
}

interface RecentPostRow {
  id: string;
  title: string;
  published_at: string;
  like_count: number;
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const t = await getTranslations("dashboard");
  const schoolT = await getTranslations("school");
  const gamesT = await getTranslations("games");
  const supabase = await createClient();
  const { data } = await supabase
    .from("game_leaderboard")
    .select("game_id, difficulty, duration_ms")
    .eq("user_id", user.id)
    .returns<BestRow[]>();
  const bests = data ?? [];
  const { data: recentData } = await supabase
    .from("posts")
    .select("id,title,published_at,like_count")
    .eq("author_id", user.id)
    .order("published_at", { ascending: false })
    .limit(3)
    .returns<RecentPostRow[]>();
  const recentPosts = recentData ?? [];
  const classrooms = (await listMyClassrooms()).slice(0, 5);
  const profile = await getProfile(user.id);
  const isStaff = profile?.role === "staff" || profile?.role === "admin";
  const schoolNav = isStaff ? filterSchoolNav(await getMyPerms(user.id)) : [];

  if (isStaff) {
    return (
      <SectionShell section="dashboard" wide>
        <section className="rounded-2xl border bg-card p-5">
          <h1 className="font-display text-2xl">{schoolT("home.staffTitle")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">{schoolT("home.staffIntro")}</p>
          {schoolNav.length === 0 ? (
            <p className="mt-5 text-sm text-muted">{schoolT("home.emptyStaff")}</p>
          ) : (
            <nav className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={schoolT("home.staffTitle")}>
              {schoolNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-xl border border-line bg-background px-4 py-3 text-sm font-medium transition hover:border-crater"
                >
                  {schoolT(`nav.${item.labelKey}`)}
                </Link>
              ))}
            </nav>
          )}
        </section>

        <section className="mt-6 rounded-2xl border bg-card p-5">
          <h2 className="font-medium">{schoolT("home.notesTitle")}</h2>
          {recentPosts.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t("noNotes")}</p>
          ) : (
            <ul className="mt-4 divide-y">
              {recentPosts.map((post) => (
                <li key={post.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <Link href={`/notebook/${post.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{post.title || t("untitled")}</Link>
                  <time className="text-xs text-muted">{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(post.published_at))}</time>
                  <span className="text-xs text-muted">{t("likes", { count: post.like_count })}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/notebook/me" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-4")}>{t("goWrite")}</Link>
        </section>

        <section className="mt-6 rounded-2xl border bg-card p-5">
          <h2 className="font-medium">{schoolT("home.classroomsTitle")}</h2>
          {classrooms.length === 0 ? (
            <div className="mt-4 flex flex-col items-start gap-3">
              <p className="text-sm text-muted">{t("noClassrooms")}</p>
              <Link href="/classroom" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
                {t("goClassrooms")}
              </Link>
            </div>
          ) : (
            <ul className="mt-4 divide-y">
              {classrooms.map((classroom) => (
                <li key={classroom.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <School size={16} className="shrink-0 text-muted" aria-hidden />
                  <Link href={`/classroom/${classroom.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {classroom.name || t("untitled")}
                  </Link>
                  <span className="shrink-0 rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">
                    {classroom.myRole === "teacher" ? t("teaching") : t("studying")}
                  </span>
                  <Link href={`/classroom/${classroom.id}`} className="shrink-0 text-xs text-muted underline underline-offset-2 transition-colors duration-200 hover:text-ink">
                    {t("goClassroom")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </SectionShell>
    );
  }

  return (
    <SectionShell section="dashboard">
      {/* 成绩卡（docs/plan/04 P2-4）；后续 P3/P4 的笔记卡、教室卡并列于此 */}
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-medium">{t("scoresTitle")}</h2>
        {bests.length === 0 ? (
          <div className="mt-4 flex flex-col items-start gap-3">
            <p className="text-sm text-muted">{t("noScores")}</p>
            <Link href="/games" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              {t("goPlay")}
            </Link>
          </div>
        ) : (
          <ul className="mt-4 divide-y">
            {games.map((def) =>
              def.difficulties.map((difficulty, i) => {
                const row = bests.find((b) => b.game_id === def.id && b.difficulty === difficulty);
                if (!row) return null;
                return (
                  <li key={`${def.id}:${difficulty}`} className="flex items-center gap-3 py-2.5 text-sm">
                    <def.icon size={16} className="text-muted" />
                    <span className="font-medium">{gamesT(`items.${def.id}.name`)}</span>
                    <span className="flex items-center gap-1 text-xs text-muted">
                      {Array.from({ length: i + 1 }, (_, k) => <Crown key={k} size={10} />)}
                      {gamesT(`difficulty.${difficulty}`)}
                    </span>
                    <span className="ml-auto font-serif tabular-nums">{formatMs(row.duration_ms)}</span>
                    <Link
                      href={`/games/${def.id}/ranks?difficulty=${difficulty}`}
                      className="text-xs text-muted underline underline-offset-2 transition-colors duration-200 hover:text-ink"
                    >
                      {t("viewRanks")}
                    </Link>
                  </li>
                );
              }),
            )}
          </ul>
        )}
      </section>
      <section className="mt-6 rounded-2xl border bg-card p-5">
        <h2 className="font-medium">{t("notesTitle")}</h2>
        {recentPosts.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t("noNotes")}</p>
        ) : (
          <ul className="mt-4 divide-y">
            {recentPosts.map((post) => (
              <li key={post.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <Link href={`/notebook/${post.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{post.title || t("untitled")}</Link>
                <time className="text-xs text-muted">{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(post.published_at))}</time>
                <span className="text-xs text-muted">{t("likes", { count: post.like_count })}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/notebook/me" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-4")}>{t("goWrite")}</Link>
      </section>
      <section className="mt-6 rounded-2xl border bg-card p-5">
        <h2 className="font-medium">{t("classroomsTitle")}</h2>
        {classrooms.length === 0 ? (
          <div className="mt-4 flex flex-col items-start gap-3">
            <p className="text-sm text-muted">{t("noClassrooms")}</p>
            <Link href="/classroom" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              {t("goClassrooms")}
            </Link>
          </div>
        ) : (
          <ul className="mt-4 divide-y">
            {classrooms.map((classroom) => (
              <li key={classroom.id} className="flex items-center gap-3 py-2.5 text-sm">
                <School size={16} className="shrink-0 text-muted" aria-hidden />
                <Link href={`/classroom/${classroom.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {classroom.name || t("untitled")}
                </Link>
                <span className="shrink-0 rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">
                  {classroom.myRole === "teacher" ? t("teaching") : t("studying")}
                </span>
                <Link href={`/classroom/${classroom.id}`} className="shrink-0 text-xs text-muted underline underline-offset-2 transition-colors duration-200 hover:text-ink">
                  {t("goClassroom")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SectionShell>
  );
}
