import { Crown, School } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { listMyClassrooms } from "@/features/classroom/actions";
import type { ClassroomMeta } from "@/features/classroom/types";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import { getMyAccounts, getMyLearningSummary, getMyPendingAssignments, getMyStudents } from "@/features/school/customer";
import {
  getFinanceOverview,
  getFollowUpFunnel,
  getMyClassroomCards,
  getMyMonthlyPerformance,
  getMyOverdueFollowUps,
  getMyTeachingCard,
  getStaffStats,
  getTodaySchedule,
  type FinanceOverview,
  type FollowUpFunnelBucket,
  type MyClassroomCard,
  type MyOverdueFollowUp,
  type MyPerformance,
  type MyTeachingCard,
  type StaffStats,
  type TodaySessionRow,
} from "@/features/school/dashboard";
import { countPendingRefunds } from "@/features/school/finance";
import { formatMs } from "@/features/games/format";
import { games } from "@/features/games/registry";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import type { PermissionKey } from "@/features/school/permissions";
import { addDays } from "@/features/school/schedule";
import { getWeekSchedule } from "@/features/school/actions";
import { Link } from "@/i18n/navigation";
import { getMyPerms, getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const EMPTY_STATS: StaffStats = { enrolledCount: 0, leadCount: 0, weekSessionCount: 0, overdueFollowUpCount: 0 };
const EMPTY_PERFORMANCE: MyPerformance = { dueTotal: 0, paidTotal: 0, enrollCount: 0 };
const EMPTY_TEACHING: MyTeachingCard = { sessions: [], pendingGradingCount: 0 };
const EMPTY_FINANCE: FinanceOverview = { dueTotal: 0, paidTotal: 0, refundTotal: 0, overdueOrderCount: 0 };

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

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/** 学生/家长共用的既有三卡（成绩/笔记/教室），10-§7 在其上加各自的顾客侧卡片；本身够轻量，首页保留。 */
function CustomerSharedSections({
  t,
  gamesT,
  locale,
  bests,
  recentPosts,
  classrooms,
}: {
  t: Translator;
  gamesT: Translator;
  locale: string;
  bests: BestRow[];
  recentPosts: RecentPostRow[];
  classrooms: ClassroomMeta[];
}) {
  return (
    <>
      <section className="mt-6 rounded-2xl border bg-card p-5">
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
    </>
  );
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
  const perms: Set<PermissionKey> = isStaff ? await getMyPerms(user.id) : new Set();

  if (isStaff) {
    const studentsFilterT = await getTranslations("school.students");
    const canStats = perms.has("student.view.all");
    const canMyFollowUps = perms.has("followup.view");
    const canMyPerformance = perms.has("finance.order.view");
    const canMyTeaching = perms.has("class.view.mine");
    const canFinanceOverview = perms.has("finance.report.view");
    const canRefundQueue = perms.has("finance.refund.approve");
    const canSeeAllSchedule = perms.has("schedule.view.all");

    const [stats, funnel, todaySessions, myFollowUps, myPerformance, myTeaching, myClassrooms, financeOverview, pendingRefundCount]: [
      StaffStats,
      FollowUpFunnelBucket[],
      TodaySessionRow[],
      MyOverdueFollowUp[],
      MyPerformance,
      MyTeachingCard,
      MyClassroomCard[],
      FinanceOverview,
      number,
    ] = await Promise.all([
      canStats ? safe(getStaffStats, EMPTY_STATS) : Promise.resolve(EMPTY_STATS),
      canStats ? safe(getFollowUpFunnel, []) : Promise.resolve([]),
      safe(getTodaySchedule, []),
      canMyFollowUps ? safe(() => getMyOverdueFollowUps(user.id), []) : Promise.resolve([]),
      canMyPerformance ? safe(() => getMyMonthlyPerformance(user.id), EMPTY_PERFORMANCE) : Promise.resolve(EMPTY_PERFORMANCE),
      canMyTeaching ? safe(() => getMyTeachingCard(user.id), EMPTY_TEACHING) : Promise.resolve(EMPTY_TEACHING),
      canMyTeaching ? safe(() => getMyClassroomCards(user.id), []) : Promise.resolve([]),
      canFinanceOverview ? safe(getFinanceOverview, EMPTY_FINANCE) : Promise.resolve(EMPTY_FINANCE),
      canRefundQueue ? safe(countPendingRefunds, 0) : Promise.resolve(0),
    ]);

    // -------------------------------------------------------------------------
    // 关注重点分区（10-§7 卡片池的呈现重构，2026-07-10）：
    //   教学（我的课与待办 + 我的班级）/ 招生与跟进（待跟进 + 业绩 + 漏斗）/
    //   全校概览（统计行 + 今日课表 + 财务 + 待审退费）。
    // 排序按角色重心：管理者（student.view.all）全校在前；教师教学在前；学辅招生在前。
    // 降噪：管理者视角下空的「个人」卡不渲染（自己不带班/不下单时是纯噪音）。
    // -------------------------------------------------------------------------
    const isManager = canStats;
    const hasTeachingWork = myTeaching.sessions.length > 0 || myTeaching.pendingGradingCount > 0 || myClassrooms.length > 0;
    const showTeachingCard = canMyTeaching && (!isManager || hasTeachingWork);
    const showMyClasses = canMyTeaching && myClassrooms.length > 0;
    const showFollowUps = canMyFollowUps && (!isManager || myFollowUps.length > 0);
    const showPerformance =
      canMyPerformance && !(isManager && canFinanceOverview && myPerformance.dueTotal === 0 && myPerformance.enrollCount === 0);
    const funnelMax = Math.max(1, ...funnel.map((bucket) => bucket.count));
    const dateLine = new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(new Date());

    const teachingCards = (
      <>
        {showTeachingCard && (
          <section className="rounded-2xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{schoolT("home.myTeachingTitle")}</h2>
              {myTeaching.pendingGradingCount > 0 && (
                <Link href="/dashboard/classes" className="text-xs text-rose underline underline-offset-2">
                  {schoolT("home.pendingGrading", { count: myTeaching.pendingGradingCount })}
                </Link>
              )}
            </div>
            {myTeaching.sessions.length === 0 ? (
              <p className="mt-4 text-sm text-muted">{schoolT("home.myTeachingEmpty")}</p>
            ) : (
              <ul className="mt-4 divide-y">
                {myTeaching.sessions.slice(0, 4).map((session) => (
                  <li key={session.sessionId} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <span className="min-w-[7rem] flex-1 truncate font-medium">{session.classroomName}</span>
                    <span className="shrink-0 text-xs text-muted">{session.title}</span>
                    <time className="shrink-0 text-xs text-muted">
                      {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(session.scheduledAt))}
                    </time>
                    {session.unprepared && (
                      <span className="shrink-0 rounded-full bg-rose/10 px-2 py-0.5 text-xs text-rose">{schoolT("home.unprepared")}</span>
                    )}
                    <Link
                      href={`/classroom/${session.classroomId}/session/${session.sessionId}`}
                      className="shrink-0 text-xs text-crater underline underline-offset-2"
                    >
                      {session.isToday ? schoolT("home.goTeach") : schoolT("home.goPrepare")}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {showMyClasses && (
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="font-medium">{schoolT("home.myClassesTitle")}</h2>
            <ul className="mt-4 divide-y">
              {myClassrooms.map((classroom) => (
                <li key={classroom.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <Link href={`/dashboard/classes/${classroom.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {classroom.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted">
                    {classroom.capacity
                      ? schoolT("home.classActiveCap", { count: classroom.activeCount, capacity: classroom.capacity })
                      : schoolT("home.classActive", { count: classroom.activeCount })}
                  </span>
                  <span className="shrink-0 rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">
                    {schoolT("home.classProgress", { done: classroom.doneSessionCount, total: classroom.totalSessionCount })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
    const hasTeachingSection = showTeachingCard || showMyClasses;

    const salesCards = (
      <>
        {showFollowUps && (
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="font-medium">{schoolT("home.myFollowUpsTitle")}</h2>
            {myFollowUps.length === 0 ? (
              <p className="mt-4 text-sm text-muted">{schoolT("home.myFollowUpsEmpty")}</p>
            ) : (
              <ul className="mt-4 divide-y">
                {myFollowUps.map((row) => (
                  <li key={row.studentId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <Link href={`/dashboard/students/${row.studentId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {row.studentName}
                    </Link>
                    <span className="shrink-0 text-xs text-rose">
                      {new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(new Date(row.nextFollowUpAt))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {showPerformance && (
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="font-medium">{schoolT("home.myPerformanceTitle")}</h2>
            <div className="mt-4 flex flex-wrap gap-6 text-sm">
              <div>
                <p className="font-display text-xl tabular-nums">¥{myPerformance.dueTotal.toFixed(2)}</p>
                <p className="mt-1 text-xs text-muted">{schoolT("home.performanceDue")}</p>
              </div>
              <div>
                <p className="font-display text-xl tabular-nums">¥{myPerformance.paidTotal.toFixed(2)}</p>
                <p className="mt-1 text-xs text-muted">{schoolT("home.performancePaid")}</p>
              </div>
              <div>
                <p className="font-display text-xl tabular-nums">{myPerformance.enrollCount}</p>
                <p className="mt-1 text-xs text-muted">{schoolT("home.performanceEnrolls")}</p>
              </div>
            </div>
          </section>
        )}
      </>
    );
    const hasSalesSection = showFollowUps || showPerformance;

    const schoolCards = (
      <>
        {canStats && (
          <div className="col-span-full grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: schoolT("home.statEnrolled"), value: stats.enrolledCount, href: "/dashboard/students" },
              { label: schoolT("home.statLeads"), value: stats.leadCount, href: "/dashboard/students?status=lead" },
              { label: schoolT("home.statWeekSessions"), value: stats.weekSessionCount, href: "/dashboard/schedule" },
              { label: schoolT("home.statOverdueFollowUps"), value: stats.overdueFollowUpCount, href: "/dashboard/students" },
            ].map((item) => (
              <Link key={item.label} href={item.href} className="rounded-xl border border-line bg-card p-4 transition hover:border-crater/50">
                <p className="font-display text-2xl tabular-nums">{item.value}</p>
                <p className="mt-1 text-xs text-muted">{item.label}</p>
              </Link>
            ))}
          </div>
        )}
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="font-medium">{canSeeAllSchedule ? schoolT("home.todayScheduleTitle") : schoolT("home.todayScheduleTitleMine")}</h2>
          {todaySessions.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{schoolT("home.todayScheduleEmpty")}</p>
          ) : (
            <ul className="mt-4 divide-y">
              {todaySessions.map((session) => (
                <li key={session.sessionId} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="w-14 shrink-0 font-mono text-xs text-muted">
                    {new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(session.scheduledAt))}
                  </span>
                  <span className="min-w-[7rem] flex-1 truncate font-medium">{session.classroomName}</span>
                  <span className="max-w-[10rem] shrink-0 truncate text-xs text-muted">{session.title}</span>
                  {session.teacherName && (
                    <span className="shrink-0 rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">{session.teacherName}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Link href="/dashboard/schedule" className="mt-4 inline-block text-xs text-crater underline underline-offset-2">
            {schoolT("nav.schedule")}
          </Link>
        </section>
        {canStats && (
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="font-medium">{schoolT("home.funnelTitle")}</h2>
            <ul className="mt-4 grid gap-2.5">
              {funnel.map((bucket) => (
                <li key={bucket.status} className="flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0 text-xs text-muted">{studentsFilterT(bucket.status)}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-line/40">
                    <span
                      className="block h-full rounded-full bg-crater/50"
                      style={{ width: `${Math.round((bucket.count / funnelMax) * 100)}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right font-display tabular-nums">{bucket.count}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {canFinanceOverview && (
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="font-medium">{schoolT("home.financeOverviewTitle")}</h2>
            <div className="mt-4 flex flex-wrap gap-6 text-sm">
              <div>
                <p className="font-display text-xl tabular-nums">¥{financeOverview.dueTotal.toFixed(2)}</p>
                <p className="mt-1 text-xs text-muted">{schoolT("home.financeDue")}</p>
              </div>
              <div>
                <p className="font-display text-xl tabular-nums">¥{financeOverview.paidTotal.toFixed(2)}</p>
                <p className="mt-1 text-xs text-muted">{schoolT("home.financePaid")}</p>
              </div>
              <div>
                <p className="font-display text-xl tabular-nums">¥{financeOverview.refundTotal.toFixed(2)}</p>
                <p className="mt-1 text-xs text-muted">{schoolT("home.financeRefunded")}</p>
              </div>
              <div>
                <p className="font-display text-xl tabular-nums">{financeOverview.overdueOrderCount}</p>
                <p className="mt-1 text-xs text-muted">{schoolT("home.financeOverdueOrders")}</p>
              </div>
            </div>
            <Link href="/dashboard/finance" className="mt-4 inline-block text-xs text-crater underline underline-offset-2">
              {schoolT("home.goFinance")}
            </Link>
          </section>
        )}
        {canRefundQueue && pendingRefundCount > 0 && (
          <section className="rounded-2xl border border-rose/40 bg-card p-5">
            <h2 className="font-medium">{schoolT("home.refundQueueTitle", { count: pendingRefundCount })}</h2>
            <p className="mt-2 text-sm text-muted">{schoolT("home.refundQueueHint")}</p>
            <Link href="/dashboard/finance" className="mt-4 inline-block text-xs text-crater underline underline-offset-2">
              {schoolT("home.goApproveRefunds")}
            </Link>
          </section>
        )}
      </>
    );

    const sections: Array<{ key: string; label: string; cards: React.ReactNode; show: boolean }> = [
      { key: "school", label: schoolT("home.sectionSchool"), cards: schoolCards, show: true },
      { key: "teaching", label: schoolT("home.sectionTeaching"), cards: teachingCards, show: hasTeachingSection },
      { key: "sales", label: schoolT("home.sectionSales"), cards: salesCards, show: hasSalesSection },
    ];
    // 教师重心：教学在前；学辅重心：招生在前；管理者维持全校在前
    if (!isManager && canMyTeaching) {
      sections.sort((a, b) => ["teaching", "sales", "school"].indexOf(a.key) - ["teaching", "sales", "school"].indexOf(b.key));
    } else if (!isManager && canMyFollowUps) {
      sections.sort((a, b) => ["sales", "school", "teaching"].indexOf(a.key) - ["sales", "school", "teaching"].indexOf(b.key));
    }
    const visibleSections = sections.filter((section) => section.show);

    return (
      <div>
        <SchoolPageHeader title={schoolT("home.staffTitle")}>
          <p className="mt-1 text-sm text-muted">
            {schoolT("home.staffGreeting", { name: profile?.displayName || "" })} · {dateLine}
          </p>
        </SchoolPageHeader>

        {perms.size === 0 && (
          <section className="mt-6 rounded-2xl border bg-card p-5">
            <p className="text-sm text-muted">{schoolT("home.emptyStaff")}</p>
          </section>
        )}

        {visibleSections.map((section) => (
          <section key={section.key} className="mt-7">
            <h2 className="px-1 text-xs font-medium uppercase tracking-widest text-muted">{section.label}</h2>
            <div className="mt-3 grid items-start gap-4 lg:grid-cols-2">{section.cards}</div>
          </section>
        ))}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 顾客侧（学生/家长）首屏（10-§7 P4B-8，布局重构后进一步瘦身）：完整课表/作业/
  // 费用列表移到各自独立子页（/dashboard/schedule /assignments /finance），首页只
  // 保留"下一节课/待办数量/余额"这类一眼扫过的精简卡，加既有成绩/笔记/教室三卡。
  // ---------------------------------------------------------------------------
  const customerT = await getTranslations("school.customer");

  if (profile?.role === "parent") {
    const studentsT = await getTranslations("school.students");
    const summaries = await safe(getMyLearningSummary, []);

    return (
      <div>
        <section className="rounded-2xl border bg-card p-5">
          <h1 className="font-display text-2xl">{customerT("parentTitle")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">{customerT("parentIntro")}</p>
          <div className="mt-4">
            <BindCodeForm mode="guardian" />
          </div>
        </section>

        {summaries.length === 0 ? (
          <section className="mt-6 rounded-2xl border bg-card p-5">
            <p className="text-sm text-muted">{customerT("noChildren")}</p>
          </section>
        ) : (
          <section className="mt-6 grid gap-4 sm:grid-cols-2">
            {summaries.map((child) => (
              <div key={child.studentId} className="rounded-2xl border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-medium">{child.studentName}</h2>
                  {child.grade !== null && <span className="text-xs text-muted">{studentsT("grade", { grade: child.grade })}</span>}
                </div>
                <dl className="mt-4 grid gap-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">{customerT("nextSession")}</dt>
                    <dd>
                      {child.nextSessionAt
                        ? new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(child.nextSessionAt))
                        : "-"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">{customerT("starTotal")}</dt>
                    <dd>{child.starTotal}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">{customerT("paymentStatus")}</dt>
                    <dd>{customerT(`payment_${child.paymentStatus}`)}</dd>
                  </div>
                </dl>
                <Link href={`/dashboard/children?child=${child.studentId}`} className="mt-4 inline-block text-xs text-crater underline underline-offset-2">
                  {customerT("goChildDetail")}
                </Link>
              </div>
            ))}
          </section>
        )}

        <CustomerSharedSections t={t} gamesT={gamesT} locale={locale} bests={bests} recentPosts={recentPosts} classrooms={classrooms} />
      </div>
    );
  }

  const myStudents = await safe(getMyStudents, []);
  const isBound = myStudents.length > 0;
  const [nextWeekSchedule, myPendingAssignments, myAccounts] = isBound
    ? await Promise.all([
        safe(() => getWeekSchedule(new Date().toISOString(), addDays(new Date(), 7).toISOString()), []),
        safe(getMyPendingAssignments, []),
        safe(getMyAccounts, []),
      ])
    : ([[], [], []] as [Awaited<ReturnType<typeof getWeekSchedule>>, Awaited<ReturnType<typeof getMyPendingAssignments>>, Awaited<ReturnType<typeof getMyAccounts>>]);
  const myBalance = myAccounts[0]?.balance ?? 0;
  const nextSession = nextWeekSchedule[0] ?? null;

  return (
    <div>
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-medium">{customerT("myScheduleTitle")}</h2>
        {!isBound ? (
          <div className="mt-4">
            <p className="text-sm text-muted">{customerT("notBound")}</p>
            <div className="mt-3">
              <BindCodeForm mode="claim" />
            </div>
          </div>
        ) : !nextSession ? (
          <p className="mt-4 text-sm text-muted">{customerT("myScheduleEmpty")}</p>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <time className="shrink-0 font-mono text-xs text-muted">
              {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(nextSession.scheduledAt))}
            </time>
            <span className="min-w-0 flex-1 truncate font-medium">{nextSession.classroomName}</span>
            <span className="shrink-0 text-xs text-muted">{nextSession.lectureName}</span>
          </div>
        )}
        {isBound && (
          <Link href="/dashboard/schedule" className="mt-4 inline-block text-xs text-crater underline underline-offset-2">
            {schoolT("nav.schedule")}
          </Link>
        )}
      </section>

      {isBound && (
        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border bg-card p-5">
            <p className="font-display text-2xl tabular-nums">{myPendingAssignments.length}</p>
            <p className="mt-1 text-xs text-muted">{customerT("pendingAssignmentsTitle")}</p>
            <Link href="/dashboard/assignments" className="mt-3 inline-block text-xs text-crater underline underline-offset-2">
              {schoolT("nav.assignments")}
            </Link>
          </div>
          <div className="rounded-2xl border bg-card p-5">
            <p className="font-display text-2xl tabular-nums">¥{myBalance.toFixed(2)}</p>
            <p className="mt-1 text-xs text-muted">{customerT("myFinanceTitle")}</p>
            <Link href="/dashboard/finance" className="mt-3 inline-block text-xs text-crater underline underline-offset-2">
              {schoolT("nav.finance")}
            </Link>
          </div>
        </section>
      )}

      <CustomerSharedSections t={t} gamesT={gamesT} locale={locale} bests={bests} recentPosts={recentPosts} classrooms={classrooms} />
    </div>
  );
}
