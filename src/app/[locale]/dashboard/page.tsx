import { Crown, School } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { listMyClassrooms } from "@/features/classroom/actions";
import type { ClassroomMeta } from "@/features/classroom/types";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import { getMyLearningSummary, getMyPendingAssignments, getMySessionReviews, getMyStudents } from "@/features/school/customer";
import {
  getDueOrders,
  getActivityToday,
  getReviewGaps,
  getVideoQueue,
  getRenewalDueCount,
  getFinanceOverview,
  getFollowUpFunnel,
  getFollowupBoardCounts,
  getGradingQueue,
  getMyClassroomCards,
  getMyMonthlyPerformance,
  getMyOverdueFollowUps,
  getMyTeachingCard,
  getRosterMismatchCount,
  getStaffStats,
  getTemplateProgress,
  getTemplateUrgent,
  getTodaySchedule,
  getUnmarkedSessions,
  type DueOrderRow,
  type ActivityTodayRow,
  type ReviewGapRow,
  type VideoQueueRow,
  type FinanceOverview,
  type FollowUpFunnelBucket,
  type FollowupBoardCounts,
  type GradingQueueRow,
  type MyClassroomCard,
  type MyOverdueFollowUp,
  type MyPerformance,
  type MyTeachingCard,
  type RosterMismatch,
  type StaffStats,
  type TemplateProgressRow,
  type TemplateUrgentRow,
  type TodaySessionRow,
  type UnmarkedSessionRow,
} from "@/features/school/dashboard";
import { countPendingRefunds } from "@/features/school/finance";
import { formatMs } from "@/features/games/format";
import { games } from "@/features/games/registry";
import type { PermissionKey } from "@/features/school/permissions";
import { addDays } from "@/features/school/schedule";
import { getWeekSchedule } from "@/features/school/actions";
import { sizeToWH, type TilePlacement } from "@/features/school/tile-layout";
import {
  CHILD_TILE_PREFIX,
  findTileDef,
  mergeTileLayout,
  parentDefaultOrder,
  staffDefaultOrder,
  STUDENT_ORDER,
  TILE_REGISTRY,
  type EligibleTile,
  type MergedTileLayout,
  type TileAudience,
  type TileTone,
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
const EMPTY_MISMATCH: RosterMismatch = { unlinkedEnrollments: 0, orphanMembers: 0 };
const EMPTY_FOLLOWUP_COUNTS: FollowupBoardCounts = { overdue: 0, today: 0 };

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
// 磁贴装配（P4C-4 §5.3 / P4C-5 §5.4 / P4C-4b §5.8c）：取数留在服务端，磁贴壳
// （图标+眉标签+箭头+tone）由客户端 TileWorkspace 渲染，这里产出三档 body
// （full=contents、compact/minimal 缺省回落 full）与逐贴 extras。
// ---------------------------------------------------------------------------

interface TileExtra {
  tone?: TileTone;
  href?: string;
  cover?: boolean;
  /** compact 形态（宽或高为 1 的小档）：关键数+一行摘要；缺省回落 full。 */
  compact?: ReactNode;
  /** minimal 形态（1x1）：单关键数；缺省回落 compact → full。 */
  minimal?: ReactNode;
}

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
  extras: ReadonlyMap<string, TileExtra>,
): { items: TileGridItem[]; hidden: TileGridItem[] } {
  const sizesByKey = new Map(eligible.map((tile) => [tile.key, tile.allowedSizes]));
  const toItem = (placement: TilePlacement): TileGridItem | null => {
    const allowedSizes = sizesByKey.get(placement.k);
    const def = findTileDef(placement.k);
    if (!allowedSizes || !def || !contents.has(placement.k)) return null;
    const extra = extras.get(placement.k);
    return {
      key: placement.k,
      placement,
      label: labels.get(placement.k) ?? placement.k,
      allowedSizes,
      icon: def.icon,
      tone: extra?.tone ?? def.tone,
      href: extra?.href,
      cover: extra?.cover,
      node: contents.get(placement.k),
      compact: extra?.compact,
      minimal: extra?.minimal,
    };
  };
  return {
    items: merged.result.map(toItem).filter((item): item is TileGridItem => item !== null),
    // hidden 磁贴没有坐标：给默认档占位，重新加入时由客户端 resolve 落位。
    hidden: merged.hidden
      .map((key) => toItem({ k: key, x: 0, y: 0, ...sizeToWH(sizesByKey.get(key)![0]) }))
      .filter((item): item is TileGridItem => item !== null),
  };
}

/** 1x1 统计贴主体：主数垂直居中（标签在壳的眉标行，§5.4）。 */
function StatBody({ value, tone }: { value: number; tone?: TileTone }) {
  return (
    <p className={cn("flex flex-1 items-center font-display text-4xl tabular-nums", tone === "rose" && value > 0 && "text-rose")}>
      {value}
    </p>
  );
}

/** minimal 形态（§5.8c）：单关键数/短串，1x1 内绝不溢出。 */
function MinimalBody({ value, rose }: { value: ReactNode; rose?: boolean }) {
  return (
    <p className={cn("flex min-w-0 flex-1 items-center truncate font-display text-3xl tabular-nums", rose && "text-rose")}>
      {value}
    </p>
  );
}

/** compact 形态（§5.8c）：关键数 + 一行摘要。 */
function CompactBody({ value, line, rose }: { value: ReactNode; line?: string; rose?: boolean }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center gap-0.5">
      <p className={cn("truncate font-display text-2xl tabular-nums", rose && "text-rose")}>{value}</p>
      {line && <p className="truncate text-xs text-muted">{line}</p>}
    </div>
  );
}

/** 空态：一句话 + 直达按钮（§5.4 禁止只有一行灰字）。 */
function EmptyBody({ text, href, linkLabel }: { text: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3">
      <p className="text-sm text-muted">{text}</p>
      {href && linkLabel && (
        <Link href={href} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          {linkLabel}
        </Link>
      )}
    </div>
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
  extras,
}: {
  t: Translator;
  gamesT: Translator;
  locale: string;
  bests: BestRow[];
  recentPosts: RecentPostRow[];
  classrooms: ClassroomMeta[];
  labels: Map<string, string>;
  contents: Map<string, ReactNode>;
  extras: Map<string, TileExtra>;
}) {
  labels.set("myScores", t("scoresTitle"));
  extras.set("myScores", {
    href: "/games",
    minimal: <MinimalBody value={bests.length} />,
    compact: (
      <CompactBody
        value={bests.length}
        line={bests[0] ? `${gamesT(`items.${bests[0].game_id}.name`)} ${formatMs(bests[0].duration_ms)}` : t("noScores")}
      />
    ),
  });
  contents.set(
    "myScores",
    bests.length === 0 ? (
      <EmptyBody text={t("noScores")} href="/games" linkLabel={t("goPlay")} />
    ) : (
      <ul className="min-h-0 flex-1 divide-y overflow-hidden">
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
    ),
  );

  labels.set("myNotes", t("notesTitle"));
  extras.set("myNotes", {
    href: "/notebook/me",
    minimal: <MinimalBody value={recentPosts.length} />,
    compact: (
      <CompactBody value={recentPosts.length} line={recentPosts[0] ? recentPosts[0].title || t("untitled") : t("noNotes")} />
    ),
  });
  contents.set(
    "myNotes",
    recentPosts.length === 0 ? (
      <EmptyBody text={t("noNotes")} href="/notebook/me" linkLabel={t("goWrite")} />
    ) : (
      <ul className="min-h-0 flex-1 divide-y overflow-hidden">
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
    ),
  );

  labels.set("myClassrooms", t("classroomsTitle"));
  extras.set("myClassrooms", {
    href: "/classroom",
    minimal: <MinimalBody value={classrooms.length} />,
    compact: (
      <CompactBody value={classrooms.length} line={classrooms[0] ? classrooms[0].name || t("untitled") : t("noClassrooms")} />
    ),
  });
  contents.set(
    "myClassrooms",
    classrooms.length === 0 ? (
      <EmptyBody text={t("noClassrooms")} href="/classroom" linkLabel={t("goClassrooms")} />
    ) : (
      <ul className="min-h-0 flex-1 divide-y overflow-hidden">
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
    ),
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
  const myClassroomList = await listMyClassrooms();
  const classrooms = myClassroomList.slice(0, 5);
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
  const cny = new Intl.NumberFormat(locale, { style: "currency", currency: "CNY" });
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const shortFmt = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "short" });

  const labels = new Map<string, string>();
  const contents = new Map<string, ReactNode>();
  const extras = new Map<string, TileExtra>();

  if (isStaff) {
    const studentsFilterT = await getTranslations("school.students");
    const canStats = perms.has("student.view.all");
    const canMyFollowUps = perms.has("followup.view");
    const canMyPerformance = perms.has("finance.order.view") || perms.has("finance.order.create");
    const canMyTeaching = perms.has("class.view.mine");
    const canFinanceOverview = perms.has("finance.report.view");
    const canRefundQueue = perms.has("finance.refund.approve");
    const canSeeAllSchedule = perms.has("schedule.view.all");
    const canGrading = perms.has("grading.write");
    const canCourseManage = perms.has("course.manage");
    const canClassViewAll = perms.has("class.view.all");
    const canFollowupWrite = perms.has("followup.write");
    const canActivity = perms.has("activity.register");
    const canReview = perms.has("review.write");
    const canVideoReview = perms.has("video.review");
    const canRenewal = perms.has("finance.order.view")||perms.has("followup.view");

    const [
      stats,
      funnel,
      todaySessions,
      myFollowUps,
      myPerformance,
      myTeaching,
      myClassrooms,
      financeOverview,
      pendingRefundCount,
      gradingQueue,
      dueOrders,
      templateUrgent,
      templateProgress,
      unmarkedSessions,
      rosterMismatch,
      followupCounts,
      activityToday,
      reviewGaps,
      videoQueue,
      renewalDue,
    ]: [
      StaffStats,
      FollowUpFunnelBucket[],
      TodaySessionRow[],
      MyOverdueFollowUp[],
      MyPerformance,
      MyTeachingCard,
      MyClassroomCard[],
      FinanceOverview,
      number,
      GradingQueueRow[],
      DueOrderRow[],
      TemplateUrgentRow[],
      TemplateProgressRow[],
      UnmarkedSessionRow[],
      RosterMismatch,
      FollowupBoardCounts,
      ActivityTodayRow[],
      ReviewGapRow[],
      VideoQueueRow[],
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
      canGrading ? safe(() => getGradingQueue(user.id), []) : Promise.resolve([]),
      canMyPerformance ? safe(getDueOrders, []) : Promise.resolve([]),
      canCourseManage ? safe(getTemplateUrgent, []) : Promise.resolve([]),
      canCourseManage ? safe(getTemplateProgress, []) : Promise.resolve([]),
      canClassViewAll ? safe(getUnmarkedSessions, []) : Promise.resolve([]),
      canClassViewAll ? safe(getRosterMismatchCount, EMPTY_MISMATCH) : Promise.resolve(EMPTY_MISMATCH),
      canFollowupWrite ? safe(getFollowupBoardCounts, EMPTY_FOLLOWUP_COUNTS) : Promise.resolve(EMPTY_FOLLOWUP_COUNTS),
      canActivity ? safe(getActivityToday, []) : Promise.resolve([]),
      canReview ? safe(getReviewGaps, []) : Promise.resolve([]),
      canVideoReview ? safe(getVideoQueue, []) : Promise.resolve([]),
      canRenewal ? safe(getRenewalDueCount,0) : Promise.resolve(0),
    ]);

    const funnelMax = Math.max(1, ...funnel.map((bucket) => bucket.count));
    const isManager = canStats;

    // ---- 统计四贴（整贴可点） ----
    const statTiles: Array<{ key: string; label: string; value: number; href: string; tone?: TileTone }> = [
      { key: "statEnrolled", label: schoolT("home.statEnrolled"), value: stats.enrolledCount, href: "/dashboard/students" },
      { key: "statLeads", label: schoolT("home.statLeads"), value: stats.leadCount, href: "/dashboard/students?status=lead" },
      { key: "statWeekSessions", label: schoolT("home.statWeekSessions"), value: stats.weekSessionCount, href: "/dashboard/schedule" },
      {
        key: "statOverdueFollowUps",
        label: schoolT("home.statOverdueFollowUps"),
        value: stats.overdueFollowUpCount,
        href: "/dashboard/students",
        tone: "rose",
      },
    ];
    for (const stat of statTiles) {
      labels.set(stat.key, stat.label);
      extras.set(stat.key, { href: stat.href, cover: true });
      contents.set(stat.key, <StatBody value={stat.value} tone={stat.tone} />);
    }

    // ---- 今日课表 ----
    labels.set("todaySchedule", canSeeAllSchedule ? schoolT("home.todayScheduleTitle") : schoolT("home.todayScheduleTitleMine"));
    extras.set("todaySchedule", {
      href: "/dashboard/schedule",
      minimal: <MinimalBody value={todaySessions.length} />,
      compact: (
        <CompactBody
          value={todaySessions.length}
          line={
            todaySessions[0]
              ? `${timeFmt.format(new Date(todaySessions[0].scheduledAt))} ${todaySessions[0].classroomName}`
              : schoolT("home.todayScheduleEmpty")
          }
        />
      ),
    });
    contents.set(
      "todaySchedule",
      todaySessions.length === 0 ? (
        <EmptyBody text={schoolT("home.todayScheduleEmpty")} href="/dashboard/schedule" linkLabel={schoolT("nav.schedule")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {todaySessions.slice(0, 12).map((session) => (
            <li key={session.sessionId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="w-12 shrink-0 font-mono text-xs text-muted">{timeFmt.format(new Date(session.scheduledAt))}</span>
              <span className="min-w-[7rem] flex-1 truncate font-medium">{session.classroomName}</span>
              <span className="max-w-[10rem] shrink-0 truncate text-xs text-muted">{session.title}</span>
              {session.teacherName && (
                <span className="shrink-0 rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">{session.teacherName}</span>
              )}
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 生源漏斗 ----
    const funnelTotal = funnel.reduce((sum, bucket) => sum + bucket.count, 0);
    labels.set("funnel", schoolT("home.funnelTitle"));
    extras.set("funnel", {
      minimal: <MinimalBody value={funnelTotal} />,
      compact: (
        <CompactBody
          value={funnelTotal}
          line={funnel
            .slice(0, 2)
            .map((bucket) => `${studentsFilterT(bucket.status)} ${bucket.count}`)
            .join(" · ")}
        />
      ),
    });
    contents.set(
      "funnel",
      <ul className="grid flex-1 content-center gap-1.5">
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
      </ul>,
    );

    // ---- 我的待跟进 ----
    labels.set("myFollowUps", schoolT("home.myFollowUpsTitle"));
    extras.set("myFollowUps", {
      href: "/dashboard/students",
      minimal: <MinimalBody value={myFollowUps.length} rose={myFollowUps.length > 0} />,
      compact: (
        <CompactBody
          value={myFollowUps.length}
          rose={myFollowUps.length > 0}
          line={
            myFollowUps[0]
              ? `${myFollowUps[0].studentName} · ${dateFmt.format(new Date(myFollowUps[0].nextFollowUpAt))}`
              : schoolT("home.myFollowUpsEmpty")
          }
        />
      ),
    });
    contents.set(
      "myFollowUps",
      myFollowUps.length === 0 ? (
        <EmptyBody text={schoolT("home.myFollowUpsEmpty")} href="/dashboard/students" linkLabel={schoolT("nav.students")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {myFollowUps.map((row) => (
            <li key={row.studentId} className="flex items-center justify-between gap-3 py-2 text-sm">
              <Link href={`/dashboard/students/${row.studentId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {row.studentName}
              </Link>
              <span className="shrink-0 rounded-full bg-rose/10 px-2 py-0.5 text-xs text-rose">
                {dateFmt.format(new Date(row.nextFollowUpAt))}
              </span>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 本月业绩 ----
    labels.set("myPerformance", schoolT("home.myPerformanceTitle"));
    extras.set("myPerformance", {
      href: "/dashboard/finance",
      // 2x1 的 full（三小数并排）本就放得下，只补 1x1 的单金额档。
      minimal: <MinimalBody value={cny.format(myPerformance.paidTotal)} />,
    });
    contents.set(
      "myPerformance",
      <div className="flex flex-1 flex-wrap content-center items-center gap-x-6 gap-y-2">
        {[
          { value: cny.format(myPerformance.dueTotal), label: schoolT("home.performanceDue") },
          { value: cny.format(myPerformance.paidTotal), label: schoolT("home.performancePaid") },
          { value: String(myPerformance.enrollCount), label: schoolT("home.performanceEnrolls") },
        ].map((item) => (
          <div key={item.label}>
            <p className="font-display text-xl tabular-nums">{item.value}</p>
            <p className="mt-0.5 text-xs text-muted">{item.label}</p>
          </div>
        ))}
      </div>,
    );

    // ---- 我的课与待办 ----
    labels.set("myTeaching", schoolT("home.myTeachingTitle"));
    extras.set("myTeaching", {
      href: "/dashboard/classes",
      minimal: <MinimalBody value={myTeaching.sessions.length} />,
      compact: (
        <CompactBody
          value={myTeaching.sessions.length}
          line={
            myTeaching.sessions[0]
              ? `${myTeaching.sessions[0].classroomName} · ${shortFmt.format(new Date(myTeaching.sessions[0].scheduledAt))}`
              : schoolT("home.myTeachingEmpty")
          }
        />
      ),
    });
    contents.set(
      "myTeaching",
      <>
        {myTeaching.pendingGradingCount > 0 && (
          <Link href="/dashboard/classes" className="mb-1 shrink-0 self-start text-xs text-rose underline underline-offset-2">
            {schoolT("home.pendingGrading", { count: myTeaching.pendingGradingCount })}
          </Link>
        )}
        {myTeaching.sessions.length === 0 ? (
          <EmptyBody text={schoolT("home.myTeachingEmpty")} href="/dashboard/classes" linkLabel={schoolT("nav.classes")} />
        ) : (
          <ul className="min-h-0 flex-1 divide-y overflow-hidden">
            {myTeaching.sessions.slice(0, 6).map((session) => (
              <li key={session.sessionId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-[7rem] flex-1 truncate font-medium">{session.classroomName}</span>
                <span className="shrink-0 text-xs text-muted">{session.title}</span>
                <time className="shrink-0 text-xs text-muted">{shortFmt.format(new Date(session.scheduledAt))}</time>
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
    extras.set("myClasses", {
      href: "/dashboard/classes",
      minimal: <MinimalBody value={myClassrooms.length} />,
      compact: (
        <CompactBody
          value={myClassrooms.length}
          line={myClassrooms[0] ? myClassrooms[0].name : schoolT("home.myClassroomsEmpty")}
        />
      ),
    });
    contents.set(
      "myClasses",
      myClassrooms.length === 0 ? (
        <EmptyBody text={schoolT("home.myClassroomsEmpty")} href="/dashboard/classes" linkLabel={schoolT("nav.classes")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
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
      ),
    );

    // ---- 财务概览 ----
    labels.set("financeOverview", schoolT("home.financeOverviewTitle"));
    extras.set("financeOverview", {
      href: "/dashboard/finance",
      minimal: <MinimalBody value={cny.format(financeOverview.paidTotal)} />,
      compact: (
        <CompactBody
          value={cny.format(financeOverview.paidTotal)}
          line={`${schoolT("home.financeDue")} ${cny.format(financeOverview.dueTotal)}`}
        />
      ),
    });
    contents.set(
      "financeOverview",
      <div className="grid flex-1 grid-cols-2 content-center gap-3 lg:grid-cols-4">
        {[
          { value: cny.format(financeOverview.dueTotal), label: schoolT("home.financeDue") },
          { value: cny.format(financeOverview.paidTotal), label: schoolT("home.financePaid") },
          { value: cny.format(financeOverview.refundTotal), label: schoolT("home.financeRefunded") },
          { value: String(financeOverview.overdueOrderCount), label: schoolT("home.financeOverdueOrders") },
        ].map((item) => (
          <div key={item.label}>
            <p className="font-display text-xl tabular-nums">{item.value}</p>
            <p className="mt-0.5 text-xs text-muted">{item.label}</p>
          </div>
        ))}
      </div>,
    );

    // ---- 待审退费（count=0 时不进池，§5.6 自动隐藏） ----
    labels.set("refundQueue", schoolT("home.refundQueueLabel"));
    extras.set("refundQueue", { href: "/dashboard/finance", cover: true });
    contents.set("refundQueue", <StatBody value={pendingRefundCount} tone="rose" />);

    // ---- 批改清单（§0.4）：逐份直达批改页 ----
    labels.set("gradingQueue", schoolT("home.gradingQueueTitle"));
    extras.set("gradingQueue", {
      href: "/dashboard/classes",
      tone: gradingQueue.length > 0 ? "rose" : undefined,
      minimal: <MinimalBody value={gradingQueue.length} rose={gradingQueue.length > 0} />,
      compact: (
        <CompactBody
          value={gradingQueue.length}
          rose={gradingQueue.length > 0}
          line={
            gradingQueue[0]
              ? `${gradingQueue[0].studentName} · ${gradingQueue[0].assignmentTitle}`
              : schoolT("home.gradingQueueEmpty")
          }
        />
      ),
    });
    contents.set(
      "gradingQueue",
      gradingQueue.length === 0 ? (
        <EmptyBody text={schoolT("home.gradingQueueEmpty")} href="/dashboard/classes" linkLabel={schoolT("nav.classes")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {gradingQueue.map((row) => (
            <li key={`${row.assignmentId}:${row.studentName}:${row.submittedAt}`} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="shrink-0 font-medium">{row.studentName}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{row.assignmentTitle}</span>
              <time className="shrink-0 text-xs text-muted">{shortFmt.format(new Date(row.submittedAt))}</time>
              <Link
                href={`/classroom/${row.classroomId}/assignment/${row.assignmentId}`}
                className="shrink-0 text-xs text-crater underline underline-offset-2"
              >
                {schoolT("home.goGrade")}
              </Link>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 催缴名单（§0.1/§0.5）：scope 由 orders RLS 决定，同贴双 scope ----
    labels.set("dueOrders", schoolT("home.dueOrdersTitle"));
    extras.set("dueOrders", {
      tone: dueOrders.length > 0 ? "rose" : undefined,
      minimal: <MinimalBody value={dueOrders.length} rose={dueOrders.length > 0} />,
      compact: (
        <CompactBody
          value={dueOrders.length}
          rose={dueOrders.length > 0}
          line={
            dueOrders[0]
              ? `${dueOrders[0].studentName} · ${schoolT("home.dueAmount", { amount: cny.format(dueOrders[0].dueAmount) })}`
              : schoolT("home.dueOrdersEmpty")
          }
        />
      ),
    });
    contents.set(
      "dueOrders",
      dueOrders.length === 0 ? (
        <EmptyBody text={schoolT("home.dueOrdersEmpty")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {dueOrders.map((row) => (
            <li key={row.orderId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Link href={`/dashboard/students/${row.studentId}#finance`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {row.studentName}
              </Link>
              <span className="shrink-0 rounded-full bg-rose/10 px-2 py-0.5 text-xs tabular-nums text-rose">
                {schoolT("home.dueAmount", { amount: cny.format(row.dueAmount) })}
              </span>
              <time className="shrink-0 text-xs text-muted">{dateFmt.format(new Date(row.createdAt))}</time>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 倒排期（§0.3）：即将开课未备模板 ----
    labels.set("templateUrgent", schoolT("home.templateUrgentTitle"));
    extras.set("templateUrgent", {
      tone: templateUrgent.length === 0 ? "leaf" : "rose",
      minimal: <MinimalBody value={templateUrgent.length} rose={templateUrgent.length > 0} />,
      compact: (
        <CompactBody
          value={templateUrgent.length}
          rose={templateUrgent.length > 0}
          line={
            templateUrgent[0]
              ? `${templateUrgent[0].courseTitle} · ${templateUrgent[0].lectureName}`
              : schoolT("home.templateUrgentEmpty")
          }
        />
      ),
    });
    contents.set(
      "templateUrgent",
      templateUrgent.length === 0 ? (
        <EmptyBody text={schoolT("home.templateUrgentEmpty")} href="/dashboard/courses" linkLabel={schoolT("nav.courses")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {templateUrgent.map((row) => (
            <li key={row.sessionId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Link
                href={`/dashboard/courses/${row.courseId}/lectures/${row.lectureId}`}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {row.courseTitle} · {row.lectureName}
              </Link>
              <span className="shrink-0 text-xs text-muted">{row.classroomName}</span>
              <time className="shrink-0 rounded-full bg-rose/10 px-2 py-0.5 text-xs text-rose">
                {shortFmt.format(new Date(row.scheduledAt))}
              </time>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 模板完成度（教研） ----
    const progressReady = templateProgress.reduce((sum, row) => sum + row.ready, 0);
    const progressTotal = templateProgress.reduce((sum, row) => sum + row.total, 0);
    labels.set("templateProgress", schoolT("home.templateProgressTitle"));
    extras.set("templateProgress", {
      href: "/dashboard/courses",
      minimal: <MinimalBody value={`${progressReady}/${progressTotal}`} />,
      compact: (
        <CompactBody
          value={`${progressReady}/${progressTotal}`}
          line={
            templateProgress[0]
              ? `${studentsFilterT("grade", { grade: templateProgress[0].grade })} ${templateProgress[0].ready}/${templateProgress[0].total}`
              : schoolT("home.templateProgressEmpty")
          }
        />
      ),
    });
    contents.set(
      "templateProgress",
      templateProgress.length === 0 ? (
        <EmptyBody text={schoolT("home.templateProgressEmpty")} href="/dashboard/courses" linkLabel={schoolT("nav.courses")} />
      ) : (
        <ul className="grid flex-1 content-center gap-1.5">
          {templateProgress.map((row) => (
            <li key={row.grade} className="flex items-center gap-3 text-sm">
              <span className="w-14 shrink-0 truncate text-xs text-muted">{studentsFilterT("grade", { grade: row.grade })}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-line/40">
                <span
                  className="block h-full rounded-full bg-leaf-deep/60"
                  style={{ width: `${Math.round((row.ready / Math.max(1, row.total)) * 100)}%` }}
                />
              </span>
              <span className="w-14 shrink-0 text-right font-display text-xs tabular-nums">
                {row.ready}/{row.total}
              </span>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 未点名课次（§0.2 教务） ----
    labels.set("unmarkedAttendance", schoolT("home.unmarkedTitle"));
    extras.set("unmarkedAttendance", {
      tone: unmarkedSessions.length === 0 ? "leaf" : "rose",
      minimal: <MinimalBody value={unmarkedSessions.length} rose={unmarkedSessions.length > 0} />,
      compact: (
        <CompactBody
          value={unmarkedSessions.length}
          rose={unmarkedSessions.length > 0}
          line={
            unmarkedSessions[0]
              ? `${unmarkedSessions[0].classroomName} · ${shortFmt.format(new Date(unmarkedSessions[0].scheduledAt))}`
              : schoolT("home.unmarkedEmpty")
          }
        />
      ),
    });
    contents.set(
      "unmarkedAttendance",
      unmarkedSessions.length === 0 ? (
        <EmptyBody text={schoolT("home.unmarkedEmpty")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {unmarkedSessions.map((row) => (
            <li key={row.sessionId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <Link href={`/dashboard/classes/${row.classroomId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {row.classroomName}
              </Link>
              <span className="max-w-[8rem] shrink-0 truncate text-xs text-muted">{row.title}</span>
              <time className="shrink-0 text-xs text-muted">{shortFmt.format(new Date(row.scheduledAt))}</time>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 花名册错位（§0.2）：两计数，整贴进班级列表 ----
    const mismatchTotal = rosterMismatch.unlinkedEnrollments + rosterMismatch.orphanMembers;
    labels.set("rosterMismatch", schoolT("home.rosterMismatchTitle"));
    extras.set("rosterMismatch", {
      href: "/dashboard/classes",
      cover: true,
      tone: mismatchTotal > 0 ? "rose" : undefined,
      // 2x1 的 full（两计数并排）放得下，只补 1x1 的总数档。
      minimal: <MinimalBody value={mismatchTotal} rose={mismatchTotal > 0} />,
    });
    contents.set(
      "rosterMismatch",
      <div className="flex flex-1 flex-wrap content-center items-center gap-x-5 gap-y-1">
        <div>
          <p className={cn("font-display text-2xl tabular-nums", rosterMismatch.unlinkedEnrollments > 0 && "text-rose")}>
            {rosterMismatch.unlinkedEnrollments}
          </p>
          <p className="text-[11px] text-muted">{schoolT("home.rosterUnlinked")}</p>
        </div>
        <div>
          <p className={cn("font-display text-2xl tabular-nums", rosterMismatch.orphanMembers > 0 && "text-rose")}>
            {rosterMismatch.orphanMembers}
          </p>
          <p className="text-[11px] text-muted">{schoolT("home.rosterOrphan")}</p>
        </div>
      </div>,
    );

    // ---- 跟进工作台入口（§6） ----
    labels.set("followupBoardEntry", schoolT("home.followupBoardTitle"));
    extras.set("followupBoardEntry", {
      href: "/dashboard/followups",
      cover: true,
      minimal: <MinimalBody value={followupCounts.overdue} rose={followupCounts.overdue > 0} />,
    });
    contents.set(
      "followupBoardEntry",
      <div className="flex flex-1 flex-wrap content-center items-center gap-x-5 gap-y-1">
        <div>
          <p className={cn("font-display text-2xl tabular-nums", followupCounts.overdue > 0 && "text-rose")}>{followupCounts.overdue}</p>
          <p className="text-[11px] text-muted">{schoolT("home.followupOverdue")}</p>
        </div>
        <div>
          <p className="font-display text-2xl tabular-nums">{followupCounts.today}</p>
          <p className="text-[11px] text-muted">{schoolT("home.followupToday")}</p>
        </div>
      </div>,
    );

    labels.set("activityToday", schoolT("home.activityTodayTitle"));
    extras.set("activityToday", { href: "/dashboard/activities", cover: true, minimal: <MinimalBody value={activityToday.length} />, compact: <CompactBody value={activityToday.length} line={activityToday[0]?.title ?? schoolT("home.activityTodayEmpty")} /> });
    contents.set("activityToday", activityToday.length===0?<EmptyBody text={schoolT("home.activityTodayEmpty")}/>:<ul className="min-h-0 flex-1 divide-y overflow-hidden">{activityToday.map(row=><li key={row.id} className="flex items-center gap-3 py-2 text-sm"><time className="shrink-0 text-xs text-muted">{timeFmt.format(new Date(row.scheduledAt))}</time><span className="min-w-0 flex-1 truncate font-medium">{row.title}</span><span className="text-xs text-muted">{schoolT("home.activityBooked",{count:row.bookedCount})}</span></li>)}</ul>);
    labels.set("reviewGaps",schoolT("home.reviewGapsTitle"));extras.set("reviewGaps",{href:"/dashboard/classes",cover:true,minimal:<MinimalBody value={reviewGaps.length} rose={reviewGaps.length>0}/>});contents.set("reviewGaps",reviewGaps.length===0?<EmptyBody text={schoolT("home.reviewGapsEmpty")}/>:<ul className="min-h-0 flex-1 divide-y overflow-hidden">{reviewGaps.map(x=><li key={x.sessionId} className="py-2 text-sm"><Link href={`/dashboard/classes/${x.classroomId}`} className="font-medium hover:underline">{x.classroomName}</Link><span className="ml-2 text-xs text-muted">{x.title}</span></li>)}</ul>);
    labels.set("videoQueue",schoolT("home.videoQueueTitle"));extras.set("videoQueue",{href:"/dashboard/videos",cover:true,minimal:<MinimalBody value={videoQueue.length} rose={videoQueue.length>0}/>});contents.set("videoQueue",videoQueue.length===0?<EmptyBody text={schoolT("home.videoQueueEmpty")}/>:<ul className="min-h-0 flex-1 divide-y overflow-hidden">{videoQueue.map(x=><li key={x.id} className="flex justify-between py-2 text-sm"><span className="font-medium">{x.studentName}</span><time className="text-xs text-muted">{dateFmt.format(new Date(x.submittedAt))}</time></li>)}</ul>);
    labels.set("renewalDue",schoolT("home.renewalDueTitle"));extras.set("renewalDue",{href:"/dashboard/followups?bucket=renewal",cover:true,minimal:<MinimalBody value={renewalDue} rose={renewalDue>0}/>});contents.set("renewalDue",<CompactBody value={renewalDue} rose={renewalDue>0} line={schoolT("home.renewalDueHint")}/>);

    const eligible = pickEligible("staff", perms).filter((tile) => tile.key !== "refundQueue" || pendingRefundCount > 0);
    // 管理者且待跟进为空：myFollowUps 不进默认序（留在池里可手动加回，§5.6）。
    const defaultExclude = isManager && myFollowUps.length === 0 ? ["myFollowUps"] : [];
    const merged = mergeTileLayout(eligible, userTiles, staffDefaultOrder(perms), defaultExclude);
    const { items, hidden } = buildTileItems(merged, eligible, labels, contents, extras);

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
  buildSharedCustomerTiles({ t, gamesT, locale, bests, recentPosts, classrooms, labels, contents, extras });

  if (profile?.role === "parent") {
    const studentsT = await getTranslations("school.students");
    const [summaries, parentWeekSchedule, parentReviews] = await Promise.all([
      safe(getMyLearningSummary, []),
      safe(() => getWeekSchedule(new Date().toISOString(), addDays(new Date(), 7).toISOString()), []),
      safe(()=>getMySessionReviews(addDays(new Date(),-180).toISOString(),new Date().toISOString()),[]),
    ]);
    const weekFmt = new Intl.DateTimeFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" });

    for (const child of summaries) {
      const key = `${CHILD_TILE_PREFIX}${child.studentId}`;
      const nextAt = child.nextSessionAt ? shortFmt.format(new Date(child.nextSessionAt)) : "-";
      // §0.8：本周 N 节 + 首两个时刻（时刻串按课表在 TS 侧拼，RPC 只给数）。
      const childTimes = parentWeekSchedule
        .filter((entry) => entry.studentName === child.studentName)
        .slice(0, 2)
        .map((entry) => weekFmt.format(new Date(entry.scheduledAt)))
        .join(locale === "zh" ? "、" : ", ");
      const weekLine =
        child.weekSessionCount > 0 && childTimes
          ? customerT("weekSessionsValue", { count: child.weekSessionCount, times: childTimes })
          : customerT("weekSessionsCount", { count: child.weekSessionCount });
      const recentReview=parentReviews.find(review=>review.studentId===child.studentId);
      labels.set(key, child.studentName);
      extras.set(key, {
        href: `/dashboard/children?child=${child.studentId}`,
        // §5.8c：childCard 的 minimal 关键数 = 下次上课时间。
        minimal: <MinimalBody value={nextAt} />,
        compact: <CompactBody value={nextAt} line={`${customerT("paymentStatus")} · ${customerT(`payment_${child.paymentStatus}`)}`} />,
      });
      contents.set(
        key,
        <>
          {child.grade !== null && <p className="shrink-0 text-xs text-muted">{studentsT("grade", { grade: child.grade })}</p>}
          <dl className="mt-2 grid flex-1 content-start gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{customerT("nextSession")}</dt>
              <dd>{child.nextSessionAt ? shortFmt.format(new Date(child.nextSessionAt)) : "-"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted">{customerT("weekSessions")}</dt>
              <dd className="min-w-0 truncate text-right">{weekLine}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{customerT("pendingAssignmentsTitle")}</dt>
              <dd className={cn("tabular-nums", (child.pendingAssignmentCount ?? 0) > 0 && "text-rose")}>
                {child.pendingAssignmentCount ?? "—"}
              </dd>
            </div>
            {recentReview?<div className="flex justify-between gap-3"><dt className="text-muted">{customerT("recentReview")}</dt><dd className="min-w-0 truncate text-right">{customerT("recentReviewValue",{entry:recentReview.entryScore??"—",exit:recentReview.exitScore??"—"})}</dd></div>:<div className="flex justify-between gap-3"><dt className="text-muted">{customerT("starTotal")}</dt><dd className="tabular-nums">{child.starTotal}</dd></div>}
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{customerT("paymentStatus")}</dt>
              <dd>
                {child.paymentStatus === "overdue" ? (
                  <span className="rounded-full bg-rose/10 px-2 py-0.5 text-xs text-rose">{customerT("payment_overdue")}</span>
                ) : (
                  customerT(`payment_${child.paymentStatus}`)
                )}
              </dd>
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
    const { items, hidden } = buildTileItems(merged, eligible, labels, contents, extras);

    return <TileWorkspace title={customerT("parentTitle")} subtitle={subtitle} items={items} hidden={hidden} />;
  }

  // ---- 学生首屏（§0.7）：无费用磁贴（§4.4）；未绑定档案时绑定卡是固定块不是磁贴。 ----
  const myStudents = await safe(getMyStudents, []);
  const isBound = myStudents.length > 0;
  const [nextWeekSchedule, myPendingAssignments, mySummaries] = isBound
    ? await Promise.all([
        safe(() => getWeekSchedule(new Date().toISOString(), addDays(new Date(), 7).toISOString()), []),
        safe(getMyPendingAssignments, []),
        safe(getMyLearningSummary, []),
      ])
    : ([[], [], []] as [
        Awaited<ReturnType<typeof getWeekSchedule>>,
        Awaited<ReturnType<typeof getMyPendingAssignments>>,
        Awaited<ReturnType<typeof getMyLearningSummary>>,
      ]);
  const nextSession = nextWeekSchedule[0] ?? null;
  // §0.7 进教室：距开课 ≤30 分钟且本人是该班 classroom_members 成员（非 enrollment）。
  const canEnterClassroom =
    nextSession !== null &&
    new Date(nextSession.scheduledAt).getTime() - new Date().getTime() <= 30 * 60_000 &&
    myClassroomList.some((classroom) => classroom.id === nextSession.classroomId);

  if (isBound) {
    labels.set("mySchedule", customerT("myScheduleTitle"));
    extras.set("mySchedule", {
      href: "/dashboard/schedule",
      minimal: <MinimalBody value={nextWeekSchedule.length} />,
      compact: (
        <CompactBody
          value={nextWeekSchedule.length}
          line={nextSession ? `${shortFmt.format(new Date(nextSession.scheduledAt))} ${nextSession.classroomName}` : customerT("myScheduleEmpty")}
        />
      ),
    });
    contents.set(
      "mySchedule",
      !nextSession ? (
        <EmptyBody text={customerT("myScheduleEmpty")} href="/dashboard/schedule" linkLabel={schoolT("nav.schedule")} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3 py-1 text-sm">
            <time className="shrink-0 font-mono text-xs text-muted">{shortFmt.format(new Date(nextSession.scheduledAt))}</time>
            <span className="min-w-0 flex-1 truncate font-medium">{nextSession.classroomName}</span>
            <span className="shrink-0 text-xs text-muted">{nextSession.lectureName}</span>
            {canEnterClassroom && (
              <Link href={`/classroom/${nextSession.classroomId}`} className={cn(buttonVariants({ size: "sm" }), "shrink-0")}>
                {customerT("enterClassroom")}
              </Link>
            )}
          </div>
          {nextWeekSchedule.length > 1 && (
            <ul className="min-h-0 flex-1 divide-y overflow-hidden border-t">
              {nextWeekSchedule.slice(1, 5).map((entry) => (
                <li key={entry.sessionId} className="flex items-center gap-3 py-2 text-sm">
                  <time className="shrink-0 font-mono text-xs text-muted">{shortFmt.format(new Date(entry.scheduledAt))}</time>
                  <span className="min-w-0 flex-1 truncate">{entry.classroomName}</span>
                  <span className="shrink-0 text-xs text-muted">{entry.lectureName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    );

    // §0.7 列表化：最近截止 3 份逐行直达提交页，不再只给计数。
    const nearestDue = myPendingAssignments[0] ?? null;
    labels.set("pendingAssignments", customerT("pendingAssignmentsTitle"));
    extras.set("pendingAssignments", {
      href: "/dashboard/assignments",
      tone: myPendingAssignments.length > 0 ? "rose" : undefined,
      minimal: <MinimalBody value={myPendingAssignments.length} rose={myPendingAssignments.length > 0} />,
      compact: (
        <CompactBody
          value={myPendingAssignments.length}
          rose={myPendingAssignments.length > 0}
          line={
            nearestDue
              ? `${nearestDue.title} · ${nearestDue.dueAt ? shortFmt.format(new Date(nearestDue.dueAt)) : customerT("noDue")}`
              : customerT("pendingAssignmentsEmpty")
          }
        />
      ),
    });
    contents.set(
      "pendingAssignments",
      myPendingAssignments.length === 0 ? (
        <EmptyBody text={customerT("pendingAssignmentsEmpty")} href="/dashboard/assignments" linkLabel={customerT("goSubmit")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {myPendingAssignments.slice(0, 3).map((row) => (
            <li key={row.assignmentId} className="flex items-center gap-3 py-2 text-sm">
              <Link
                href={`/classroom/${row.classroomId}/assignment/${row.assignmentId}`}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {row.title}
              </Link>
              <span className="shrink-0 text-xs text-muted">
                {row.dueAt ? shortFmt.format(new Date(row.dueAt)) : customerT("noDue")}
              </span>
            </li>
          ))}
        </ul>
      ),
    );

    // §0.7 myStars：直接吃 get_my_learning_summary 本人行，不另写聚合。
    const myStar = mySummaries[0] ?? null;
    if (myStar) {
      const rateText = myStar.attendanceRate30d !== null ? `${myStar.attendanceRate30d}%` : "—";
      labels.set("myStars", customerT("myStarsTitle"));
      extras.set("myStars", {
        minimal: <MinimalBody value={myStar.starTotal} />,
        compact: <CompactBody value={myStar.starTotal} line={`${customerT("attendanceRate30d")} ${rateText}`} />,
      });
      contents.set(
        "myStars",
        <dl className="grid flex-1 content-center gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{customerT("starTotal")}</dt>
            <dd className="font-display text-2xl tabular-nums">{myStar.starTotal}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{customerT("attendanceRate30d")}</dt>
            <dd className="tabular-nums">{rateText}</dd>
          </div>
        </dl>,
      );
    }
  }

  const eligible = pickEligible("student", perms).filter(
    (tile) => isBound || (tile.key !== "mySchedule" && tile.key !== "pendingAssignments" && tile.key !== "myStars"),
  );
  const merged = mergeTileLayout(eligible, userTiles, STUDENT_ORDER);
  const { items, hidden } = buildTileItems(merged, eligible, labels, contents, extras);

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
