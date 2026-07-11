import { Crown, School } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { listMyClassrooms } from "@/features/classroom/actions";
import type { ClassroomMeta } from "@/features/classroom/types";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import { getMyLearningSummary, getMyPendingAssignments, getMyStudents } from "@/features/school/customer";
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
import type { PermissionKey } from "@/features/school/permissions";
import { addDays } from "@/features/school/schedule";
import { getWeekSchedule } from "@/features/school/actions";
import {
  CHILD_TILE_PREFIX,
  mergeTileLayout,
  parentDefaultOrder,
  staffDefaultOrder,
  STUDENT_ORDER,
  TILE_REGISTRY,
  type EligibleTile,
  type MergedTileLayout,
  type TileAudience,
} from "@/features/school/tiles";
import { TileWorkspace, type TileGridItem } from "@/features/school/TileWorkspace";
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

// ---------------------------------------------------------------------------
// 磁贴装配（P4C-4 §5.3）：取数留在服务端，每个有权限的磁贴渲染成 ReactNode 后
// 连同合并好的布局交给客户端 TileWorkspace；隐藏贴也要渲染（编辑态可即时加回）。
// ---------------------------------------------------------------------------

function pickEligible(audience: TileAudience, perms: ReadonlySet<PermissionKey>): EligibleTile[] {
  return TILE_REGISTRY.filter(
    (def) =>
      def.audiences.includes(audience) &&
      (!def.requiredPerm || perms.has(def.requiredPerm)) &&
      (!def.requiredAnyPerm || def.requiredAnyPerm.some((key) => perms.has(key))),
  ).map((def) => ({ key: def.key, allowedSizes: def.allowedSizes }));
}

function buildTileItems(
  merged: MergedTileLayout,
  eligible: readonly EligibleTile[],
  labels: ReadonlyMap<string, string>,
  contents: ReadonlyMap<string, ReactNode>,
): { items: TileGridItem[]; hidden: TileGridItem[] } {
  const sizesByKey = new Map(eligible.map((tile) => [tile.key, tile.allowedSizes]));
  const toItem = (key: string, size: TileGridItem["size"]): TileGridItem | null => {
    const allowedSizes = sizesByKey.get(key);
    if (!allowedSizes || !contents.has(key)) return null;
    return { key, size, label: labels.get(key) ?? key, allowedSizes, node: contents.get(key) };
  };
  return {
    items: merged.result.map((entry) => toItem(entry.k, entry.s)).filter((item): item is TileGridItem => item !== null),
    hidden: merged.hidden
      .map((key) => toItem(key, sizesByKey.get(key)![0]))
      .filter((item): item is TileGridItem => item !== null),
  };
}

/** 磁贴内小页头：标题 + 右侧直达链接（列表尾链接会被固定行高裁掉，统一收到头部）。 */
function TileHead({ title, href, linkLabel }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="truncate font-medium">{title}</h2>
      {href && linkLabel && (
        <Link href={href} className="shrink-0 text-xs text-crater underline underline-offset-2">
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

function StatTileContent({ value, label, href }: { value: number; label: string; href: string }) {
  return (
    <Link href={href} className="flex flex-1 flex-col justify-center">
      <p className="font-display text-3xl tabular-nums">{value}</p>
      <p className="mt-1 truncate text-xs text-muted">{label}</p>
    </Link>
  );
}

/** 学生/家长共用的成绩/笔记/教室三贴内容（原 CustomerSharedSections 拆磁贴）。 */
function buildSharedCustomerTiles({
  t,
  gamesT,
  locale,
  bests,
  recentPosts,
  classrooms,
  labels,
  contents,
}: {
  t: Translator;
  gamesT: Translator;
  locale: string;
  bests: BestRow[];
  recentPosts: RecentPostRow[];
  classrooms: ClassroomMeta[];
  labels: Map<string, string>;
  contents: Map<string, ReactNode>;
}) {
  labels.set("myScores", t("scoresTitle"));
  contents.set(
    "myScores",
    <>
      <TileHead title={t("scoresTitle")} />
      {bests.length === 0 ? (
        <div className="mt-3 flex flex-col items-start gap-3">
          <p className="text-sm text-muted">{t("noScores")}</p>
          <Link href="/games" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            {t("goPlay")}
          </Link>
        </div>
      ) : (
        <ul className="mt-2 min-h-0 flex-1 divide-y overflow-hidden">
          {games.map((def) =>
            def.difficulties.map((difficulty, i) => {
              const row = bests.find((b) => b.game_id === def.id && b.difficulty === difficulty);
              if (!row) return null;
              return (
                <li key={`${def.id}:${difficulty}`} className="flex items-center gap-3 py-2 text-sm">
                  <def.icon size={16} className="text-muted" />
                  <span className="min-w-0 flex-1 truncate font-medium">{gamesT(`items.${def.id}.name`)}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                    {Array.from({ length: i + 1 }, (_, k) => (
                      <Crown key={k} size={10} />
                    ))}
                    {gamesT(`difficulty.${difficulty}`)}
                  </span>
                  <span className="shrink-0 font-serif tabular-nums">{formatMs(row.duration_ms)}</span>
                </li>
              );
            }),
          )}
        </ul>
      )}
    </>,
  );

  labels.set("myNotes", t("notesTitle"));
  contents.set(
    "myNotes",
    <>
      <TileHead title={t("notesTitle")} href="/notebook/me" linkLabel={t("goWrite")} />
      {recentPosts.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("noNotes")}</p>
      ) : (
        <ul className="mt-2 min-h-0 flex-1 divide-y overflow-hidden">
          {recentPosts.map((post) => (
            <li key={post.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Link href={`/notebook/${post.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {post.title || t("untitled")}
              </Link>
              <time className="shrink-0 text-xs text-muted">
                {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(post.published_at))}
              </time>
            </li>
          ))}
        </ul>
      )}
    </>,
  );

  labels.set("myClassrooms", t("classroomsTitle"));
  contents.set(
    "myClassrooms",
    <>
      <TileHead title={t("classroomsTitle")} href="/classroom" linkLabel={t("goClassrooms")} />
      {classrooms.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("noClassrooms")}</p>
      ) : (
        <ul className="mt-2 min-h-0 flex-1 divide-y overflow-hidden">
          {classrooms.map((classroom) => (
            <li key={classroom.id} className="flex items-center gap-3 py-2 text-sm">
              <School size={16} className="shrink-0 text-muted" aria-hidden />
              <Link href={`/classroom/${classroom.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {classroom.name || t("untitled")}
              </Link>
              <span className="shrink-0 rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">
                {classroom.myRole === "teacher" ? t("teaching") : t("studying")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>,
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
  const { data: layoutRow } = await supabase
    .from("dashboard_layouts")
    .select("tiles")
    .eq("user_id", user.id)
    .maybeSingle<{ tiles: unknown }>();
  const userTiles = layoutRow?.tiles ?? null;
  const dateLine = new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(new Date());
  const subtitle = `${schoolT("home.staffGreeting", { name: profile?.displayName || "" })} · ${dateLine}`;

  const labels = new Map<string, string>();
  const contents = new Map<string, ReactNode>();

  if (isStaff) {
    const studentsFilterT = await getTranslations("school.students");
    const canStats = perms.has("student.view.all");
    const canMyFollowUps = perms.has("followup.view");
    const canMyPerformance = perms.has("finance.order.view") || perms.has("finance.order.create");
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

    const funnelMax = Math.max(1, ...funnel.map((bucket) => bucket.count));
    const isManager = canStats;

    // ---- 统计四贴 ----
    const statTiles: Array<{ key: string; label: string; value: number; href: string }> = [
      { key: "statEnrolled", label: schoolT("home.statEnrolled"), value: stats.enrolledCount, href: "/dashboard/students" },
      { key: "statLeads", label: schoolT("home.statLeads"), value: stats.leadCount, href: "/dashboard/students?status=lead" },
      { key: "statWeekSessions", label: schoolT("home.statWeekSessions"), value: stats.weekSessionCount, href: "/dashboard/schedule" },
      { key: "statOverdueFollowUps", label: schoolT("home.statOverdueFollowUps"), value: stats.overdueFollowUpCount, href: "/dashboard/students" },
    ];
    for (const stat of statTiles) {
      labels.set(stat.key, stat.label);
      contents.set(stat.key, <StatTileContent value={stat.value} label={stat.label} href={stat.href} />);
    }

    // ---- 今日课表 ----
    const todayTitle = canSeeAllSchedule ? schoolT("home.todayScheduleTitle") : schoolT("home.todayScheduleTitleMine");
    labels.set("todaySchedule", todayTitle);
    contents.set(
      "todaySchedule",
      <>
        <TileHead title={todayTitle} href="/dashboard/schedule" linkLabel={schoolT("nav.schedule")} />
        {todaySessions.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{schoolT("home.todayScheduleEmpty")}</p>
        ) : (
          <ul className="mt-2 min-h-0 flex-1 divide-y overflow-hidden">
            {todaySessions.slice(0, 12).map((session) => (
              <li key={session.sessionId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="w-12 shrink-0 font-mono text-xs text-muted">
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
      </>,
    );

    // ---- 生源漏斗 ----
    labels.set("funnel", schoolT("home.funnelTitle"));
    contents.set(
      "funnel",
      <>
        <TileHead title={schoolT("home.funnelTitle")} />
        <ul className="mt-3 grid gap-2">
          {funnel.map((bucket) => (
            <li key={bucket.status} className="flex items-center gap-3 text-sm">
              <span className="w-14 shrink-0 truncate text-xs text-muted">{studentsFilterT(bucket.status)}</span>
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
      </>,
    );

    // ---- 我的待跟进 ----
    labels.set("myFollowUps", schoolT("home.myFollowUpsTitle"));
    contents.set(
      "myFollowUps",
      <>
        <TileHead title={schoolT("home.myFollowUpsTitle")} href="/dashboard/students" linkLabel={schoolT("nav.students")} />
        {myFollowUps.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{schoolT("home.myFollowUpsEmpty")}</p>
        ) : (
          <ul className="mt-2 min-h-0 flex-1 divide-y overflow-hidden">
            {myFollowUps.map((row) => (
              <li key={row.studentId} className="flex items-center justify-between gap-3 py-2 text-sm">
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
      </>,
    );

    // ---- 本月业绩 ----
    labels.set("myPerformance", schoolT("home.myPerformanceTitle"));
    contents.set(
      "myPerformance",
      <>
        <TileHead title={schoolT("home.myPerformanceTitle")} />
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span>
            <span className="font-display tabular-nums">¥{myPerformance.dueTotal.toFixed(2)}</span>
            <span className="ml-1 text-xs text-muted">{schoolT("home.performanceDue")}</span>
          </span>
          <span>
            <span className="font-display tabular-nums">¥{myPerformance.paidTotal.toFixed(2)}</span>
            <span className="ml-1 text-xs text-muted">{schoolT("home.performancePaid")}</span>
          </span>
          <span>
            <span className="font-display tabular-nums">{myPerformance.enrollCount}</span>
            <span className="ml-1 text-xs text-muted">{schoolT("home.performanceEnrolls")}</span>
          </span>
        </div>
      </>,
    );

    // ---- 我的课与待办 ----
    labels.set("myTeaching", schoolT("home.myTeachingTitle"));
    contents.set(
      "myTeaching",
      <>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="truncate font-medium">{schoolT("home.myTeachingTitle")}</h2>
          {myTeaching.pendingGradingCount > 0 && (
            <Link href="/dashboard/classes" className="shrink-0 text-xs text-rose underline underline-offset-2">
              {schoolT("home.pendingGrading", { count: myTeaching.pendingGradingCount })}
            </Link>
          )}
        </div>
        {myTeaching.sessions.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{schoolT("home.myTeachingEmpty")}</p>
        ) : (
          <ul className="mt-2 min-h-0 flex-1 divide-y overflow-hidden">
            {myTeaching.sessions.slice(0, 6).map((session) => (
              <li key={session.sessionId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
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
      </>,
    );

    // ---- 我的班级 ----
    labels.set("myClasses", schoolT("home.myClassesTitle"));
    contents.set(
      "myClasses",
      <>
        <TileHead title={schoolT("home.myClassesTitle")} href="/dashboard/classes" linkLabel={schoolT("nav.classes")} />
        {myClassrooms.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{schoolT("home.myClassroomsEmpty")}</p>
        ) : (
          <ul className="mt-2 min-h-0 flex-1 divide-y overflow-hidden">
            {myClassrooms.map((classroom) => (
              <li key={classroom.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
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
        )}
      </>,
    );

    // ---- 财务概览 ----
    labels.set("financeOverview", schoolT("home.financeOverviewTitle"));
    contents.set(
      "financeOverview",
      <>
        <TileHead title={schoolT("home.financeOverviewTitle")} href="/dashboard/finance" linkLabel={schoolT("home.goFinance")} />
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          {[
            { value: `¥${financeOverview.dueTotal.toFixed(2)}`, label: schoolT("home.financeDue") },
            { value: `¥${financeOverview.paidTotal.toFixed(2)}`, label: schoolT("home.financePaid") },
            { value: `¥${financeOverview.refundTotal.toFixed(2)}`, label: schoolT("home.financeRefunded") },
            { value: String(financeOverview.overdueOrderCount), label: schoolT("home.financeOverdueOrders") },
          ].map((item) => (
            <div key={item.label}>
              <p className="font-display text-xl tabular-nums">{item.value}</p>
              <p className="mt-1 text-xs text-muted">{item.label}</p>
            </div>
          ))}
        </div>
      </>,
    );

    // ---- 待审退费（count=0 时不进池，§5.6 自动隐藏） ----
    labels.set("refundQueue", schoolT("home.refundQueueTitle", { count: pendingRefundCount }));
    contents.set(
      "refundQueue",
      <>
        <TileHead
          title={schoolT("home.refundQueueTitle", { count: pendingRefundCount })}
          href="/dashboard/finance"
          linkLabel={schoolT("home.goApproveRefunds")}
        />
        <p className="mt-2 truncate text-sm text-muted">{schoolT("home.refundQueueHint")}</p>
      </>,
    );

    const eligible = pickEligible("staff", perms).filter((tile) => tile.key !== "refundQueue" || pendingRefundCount > 0);
    // 管理者且待跟进为空：myFollowUps 不进默认序（留在池里可手动加回，§5.6）。
    const defaultExclude = isManager && myFollowUps.length === 0 ? ["myFollowUps"] : [];
    const merged = mergeTileLayout(eligible, userTiles, staffDefaultOrder(perms), defaultExclude);
    const { items, hidden } = buildTileItems(merged, eligible, labels, contents);

    return (
      <TileWorkspace
        title={schoolT("home.staffTitle")}
        subtitle={subtitle}
        prelude={
          perms.size === 0 ? (
            <section className="rounded-2xl border bg-card p-5">
              <p className="text-sm text-muted">{schoolT("home.emptyStaff")}</p>
            </section>
          ) : undefined
        }
        items={items}
        hidden={hidden}
      />
    );
  }

  const customerT = await getTranslations("school.customer");
  buildSharedCustomerTiles({ t, gamesT, locale, bests, recentPosts, classrooms, labels, contents });

  if (profile?.role === "parent") {
    const studentsT = await getTranslations("school.students");
    const summaries = await safe(getMyLearningSummary, []);

    for (const child of summaries) {
      const key = `${CHILD_TILE_PREFIX}${child.studentId}`;
      labels.set(key, child.studentName);
      contents.set(
        key,
        <>
          <TileHead title={child.studentName} href={`/dashboard/children?child=${child.studentId}`} linkLabel={customerT("goChildDetail")} />
          {child.grade !== null && <p className="mt-0.5 text-xs text-muted">{studentsT("grade", { grade: child.grade })}</p>}
          <dl className="mt-3 grid gap-2 text-sm">
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
        </>,
      );
    }

    // 家长大欢迎卡删除（§5.6）：parentIntro 收进绑定贴一句话。
    labels.set("bindChild", customerT("bindChildTitle"));
    contents.set(
      "bindChild",
      <>
        <p className="truncate text-sm text-muted">{summaries.length === 0 ? customerT("noChildren") : customerT("parentIntro")}</p>
        <div className="mt-2">
          <BindCodeForm mode="guardian" />
        </div>
      </>,
    );

    const childKeys = summaries.map((child) => `${CHILD_TILE_PREFIX}${child.studentId}`);
    const childDef = TILE_REGISTRY.find((def) => def.key === "childCard")!;
    const eligible: EligibleTile[] = [
      ...childKeys.map((key) => ({ key, allowedSizes: childDef.allowedSizes })),
      ...pickEligible("parent", perms).filter((tile) => tile.key !== "childCard"),
    ];
    const merged = mergeTileLayout(eligible, userTiles, parentDefaultOrder(childKeys));
    const { items, hidden } = buildTileItems(merged, eligible, labels, contents);

    return <TileWorkspace title={customerT("parentTitle")} subtitle={subtitle} items={items} hidden={hidden} />;
  }

  // ---- 学生首屏（§0.7）：无费用磁贴（§4.4）；未绑定档案时绑定卡是固定块不是磁贴。 ----
  const myStudents = await safe(getMyStudents, []);
  const isBound = myStudents.length > 0;
  const [nextWeekSchedule, myPendingAssignments] = isBound
    ? await Promise.all([
        safe(() => getWeekSchedule(new Date().toISOString(), addDays(new Date(), 7).toISOString()), []),
        safe(getMyPendingAssignments, []),
      ])
    : ([[], []] as [Awaited<ReturnType<typeof getWeekSchedule>>, Awaited<ReturnType<typeof getMyPendingAssignments>>]);
  const nextSession = nextWeekSchedule[0] ?? null;

  if (isBound) {
    labels.set("mySchedule", customerT("myScheduleTitle"));
    contents.set(
      "mySchedule",
      <>
        <TileHead title={customerT("myScheduleTitle")} href="/dashboard/schedule" linkLabel={schoolT("nav.schedule")} />
        {!nextSession ? (
          <p className="mt-3 text-sm text-muted">{customerT("myScheduleEmpty")}</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <time className="shrink-0 font-mono text-xs text-muted">
              {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(nextSession.scheduledAt))}
            </time>
            <span className="min-w-0 flex-1 truncate font-medium">{nextSession.classroomName}</span>
            <span className="shrink-0 text-xs text-muted">{nextSession.lectureName}</span>
          </div>
        )}
      </>,
    );

    labels.set("pendingAssignments", customerT("pendingAssignmentsTitle"));
    contents.set(
      "pendingAssignments",
      <Link href="/dashboard/assignments" className="flex flex-1 flex-col justify-center">
        <p className="font-display text-3xl tabular-nums">{myPendingAssignments.length}</p>
        <p className="mt-1 truncate text-xs text-muted">{customerT("pendingAssignmentsTitle")}</p>
      </Link>,
    );
  }

  const eligible = pickEligible("student", perms).filter(
    (tile) => isBound || (tile.key !== "mySchedule" && tile.key !== "pendingAssignments"),
  );
  const merged = mergeTileLayout(eligible, userTiles, STUDENT_ORDER);
  const { items, hidden } = buildTileItems(merged, eligible, labels, contents);

  return (
    <TileWorkspace
      title={customerT("studentTitle")}
      subtitle={subtitle}
      prelude={
        !isBound ? (
          <section className="rounded-2xl border bg-card p-5">
            <p className="text-sm text-muted">{customerT("notBound")}</p>
            <div className="mt-3">
              <BindCodeForm mode="claim" />
            </div>
          </section>
        ) : undefined
      }
      items={items}
      hidden={hidden}
    />
  );
}
