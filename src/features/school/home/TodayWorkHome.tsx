import { Suspense, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { NotificationFocus } from "@/features/events/NotificationFocus";
import { ObjectBar, ObjectWorkspace } from "@/features/school/object-workspace";
import {
  DashboardCommandPanel,
  DashboardCommandState,
  StatusStrip,
  type StatusStripItem,
} from "@/features/school/dashboard-page";
import type { PermissionKey } from "@/features/school/permissions";
import { WorkCoordinationPanel } from "@/features/school/WorkCoordinationPanel";
import { WorkItemActions } from "@/features/school/stage/WorkItemActions";
import { WorkItemGroup } from "@/features/school/stage/WorkItemGroup";
import { WorkItemList } from "@/features/school/stage/WorkItemList";
import type { WorkItemRow } from "@/features/school/stage/types";
import { TeacherTodaySessions } from "@/features/school/TeacherTodaySessions";
import {
  getTodaySessionOperations,
  type TodaySessionOperationsData,
} from "@/features/school/teacher-session-operations";
import {
  formatWorkItemReason,
  listWorkCoordinationCandidates,
  type WorkCoordinationCandidate,
  partitionByOwnership,
  resolveWorkItemHref,
  selectSpotlightGroups,
  selectTodaySchedule,
} from "@/features/school/work-items";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { HomeProps } from "./shared";
import { hasStaffHomeManagementScope, staffHomeHref } from "./staff-home-contract";
import { StaffHomeViewTabs } from "./StaffHomeViewTabs";
import {
  getStaffHomeWeekSummaryData,
  type StaffHomeWeekSummaryData,
} from "./staff-overview-data";

// P4I-17（docs/plan/19-p4i-final.md §22）：今日工作从 P4I-8 的只读试用页
// 转正为 staff 默认首页，接入 5 个真实动作（已读/稍后处理/置顶/确认/关注，
// P4I-6 建的 RPC，见 WorkItemActions.tsx）。分区结构/数据推导原样沿用
// P4I-8（`selectSpotlightGroups`/`partitionByOwnership`/`selectTodaySchedule`）。

// 四个工作分区在宽屏下并排成列（最多 4 列），而不是各自占满整行——避免每张
// 工作卡横向铺满整个视口、内容却只占一小块的观感问题（P4I-8 真实试用反馈）。
function WorkColumn({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{title}</h2>
      {children}
    </section>
  );
}

async function safeListWorkCoordinationCandidates(): Promise<WorkCoordinationCandidate[]> {
  try {
    return await listWorkCoordinationCandidates();
  } catch {
    return [];
  }
}

async function safeGetStaffHomeWeekSummaryData(): Promise<StaffHomeWeekSummaryData | null> {
  try {
    return await getStaffHomeWeekSummaryData();
  } catch {
    return null;
  }
}

async function safeGetTodaySessionOperations(now: Date): Promise<TodaySessionOperationsData | null> {
  try {
    return await getTodaySessionOperations(now);
  } catch {
    return null;
  }
}

function valueOrDash(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

function signedOrDash(value: number | null): string {
  if (value === null) return "—";
  return value > 0 ? `+${value}` : String(value);
}

function WeekBusinessSummary({
  title,
  linkLabel,
  href,
  items,
}: {
  title: string;
  linkLabel: string;
  href: string;
  items: Array<{ key: string; label: string; value: string; note: string }>;
}) {
  return (
    <section aria-labelledby="staff-week-business-summary" className="overflow-hidden rounded-xl border border-line/80 bg-card/80">
      <header className="flex min-h-10 items-center justify-between gap-3 border-b border-line/65 px-3">
        <h2 id="staff-week-business-summary" className="text-xs font-medium text-ink">{title}</h2>
        <Link href={href} className="inline-flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-ink">
          {linkLabel}
          <ArrowUpRight className="size-3" aria-hidden />
        </Link>
      </header>
      <div className="grid grid-cols-2 @2xl/page:grid-cols-5">
        {items.map((item, index) => (
          <dl
            key={item.key}
            className={cn(
              "min-w-0 px-3 py-2.5",
              index > 0 && "border-l border-line/55",
              index >= 2 && "border-t border-line/55 @2xl/page:border-t-0",
            )}
          >
            <dt className="truncate text-[10px] text-muted">{item.label}</dt>
            <dd className="mt-0.5 font-display text-xl leading-none tabular-nums text-ink">{item.value}</dd>
            <dd className="mt-1 truncate text-[9px] tabular-nums text-muted" title={item.note}>{item.note}</dd>
          </dl>
        ))}
      </div>
    </section>
  );
}

interface WeekBusinessSummaryCopy {
  arrivals: string;
  assessments: string;
  enrollments: string;
  activeClasses: string;
  activeClassesNote: string;
  remainingSeats: string;
  remainingSeatsNote: string;
  previous: string;
  difference: string;
}

function weekBusinessSummaryItems(
  data: StaffHomeWeekSummaryData | null,
  copy: WeekBusinessSummaryCopy,
): Array<{ key: string; label: string; value: string; note: string }> {
  const factByKey = new Map(data?.businessFacts.map((fact) => [fact.key, fact]) ?? []);
  const comparisonNote = (key: "arrivals" | "assessments" | "enrollments") => {
    const fact = factByKey.get(key);
    const difference = fact?.current === null || fact?.current === undefined
      || fact.previous === null || fact.previous === undefined
      ? null
      : fact.current - fact.previous;
    return `${copy.previous} ${valueOrDash(fact?.previous)} · ${copy.difference} ${signedOrDash(difference)}`;
  };
  const metricItems = (["arrivals", "assessments", "enrollments"] as const).map((key) => ({
    key,
    label: copy[key],
    value: valueOrDash(factByKey.get(key)?.current),
    note: comparisonNote(key),
  }));
  return [
    ...metricItems,
    {
      key: "activeClasses",
      label: copy.activeClasses,
      value: valueOrDash(data?.snapshot.activeClasses),
      note: copy.activeClassesNote,
    },
    {
      key: "remainingSeats",
      label: copy.remainingSeats,
      value: valueOrDash(data?.snapshot.remainingSeats),
      note: copy.remainingSeatsNote,
    },
  ];
}

async function WeekBusinessSummaryData({
  title,
  linkLabel,
  copy,
}: {
  title: string;
  linkLabel: string;
  copy: WeekBusinessSummaryCopy;
}) {
  const data = await safeGetStaffHomeWeekSummaryData();
  return (
    <WeekBusinessSummary
      title={title}
      linkLabel={linkLabel}
      href={staffHomeHref("overview", "week")}
      items={weekBusinessSummaryItems(data, copy)}
    />
  );
}

export async function TodayWorkHome({
  locale,
  user,
  profile,
  focusTarget,
  items,
  perms,
}: HomeProps & {
  focusTarget?: string;
  items: WorkItemRow[];
  perms: ReadonlySet<PermissionKey>;
}) {
  const now = new Date();
  const [schoolT, t, tClasses, hubT, overviewT, candidates, todaySessionData] = await Promise.all([
    getTranslations("school"),
    getTranslations("school.work"),
    getTranslations("school.classes"),
    getTranslations("school.home.staffHub"),
    getTranslations("school.home.overview"),
    safeListWorkCoordinationCandidates(),
    safeGetTodaySessionOperations(now),
  ]);

  const canManageWorkItems = perms.has("work_item.manage");
  const hasManagementScope = hasStaffHomeManagementScope(perms);

  const spotlightGroups = selectSpotlightGroups(items);
  const { mine, oversight } = partitionByOwnership(items);
  const todaySchedule = selectTodaySchedule(items, now);
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const dateLine = new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(now);
  const greeting = schoolT("home.staffGreeting", { name: profile?.displayName || "" });

  const renderReason = (item: WorkItemRow) => (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>{formatWorkItemReason(item, t, tClasses, locale, now)}</span>
      {item.ownershipMode === "delegated" ? <span className="text-[11px] text-muted">{t("delegatedTag")}</span> : null}
    </span>
  );
  const renderActions = (item: WorkItemRow) => <WorkItemActions item={item} />;

  const bucketLabels = {
    now: t("bucket_now"),
    overdue: t("bucket_overdue"),
    today: t("bucket_today"),
    upcoming: t("bucket_upcoming"),
    backlog: t("bucket_backlog"),
  };

  const statusItems: StatusStripItem[] = [
    { label: t("statusNow"), value: spotlightGroups.length },
    { label: t("statusMyWork"), value: mine.length },
  ];
  if (hasManagementScope) {
    statusItems.push({ label: t("statusOversight"), value: oversight.length, tone: oversight.length > 0 ? "warning" : "default" });
  }

  const weekSummaryCopy: WeekBusinessSummaryCopy = {
    arrivals: overviewT("fact_arrivals"),
    assessments: overviewT("fact_assessments"),
    enrollments: overviewT("fact_enrollments"),
    activeClasses: overviewT("snapshotActiveClasses"),
    activeClassesNote: overviewT("snapshotActiveClassesNote"),
    remainingSeats: overviewT("snapshotRemainingSeats"),
    remainingSeatsNote: overviewT("snapshotRemainingSeatsNote"),
    previous: overviewT("previousShort"),
    difference: overviewT("differenceColumn"),
  };

  return (
    <ObjectWorkspace
      objectBar={<ObjectBar title={greeting} context={[{ value: t("title") }, { value: dateLine }]} />}
      commandPanel={(
        <DashboardCommandPanel className="min-h-12 py-1.5">
          <DashboardCommandState>
            <StaffHomeViewTabs
              activeView="work"
              period="week"
              workItemCount={items.length}
              ariaLabel={hubT("viewAriaLabel")}
              workLabel={hubT("workView")}
              overviewLabel={hubT("overviewView")}
            />
          </DashboardCommandState>
        </DashboardCommandPanel>
      )}
      statusStrip={<StatusStrip items={statusItems} />}
    >
      {/* 不再 mx-auto + max-w-[96rem]：宽度由 DashboardShell 唯一决定（docs/plan/21 §3.2）。
          页面级重新居中会让总览在宽屏上比其他页窄一截，切页时横向跳动。 */}
      <div className="space-y-6">
        <NotificationFocus target={focusTarget} />
        <Suspense
          fallback={(
            <WeekBusinessSummary
              title={hubT("weekSummaryTitle")}
              linkLabel={hubT("openOverview")}
              href={staffHomeHref("overview", "week")}
              items={weekBusinessSummaryItems(null, weekSummaryCopy)}
            />
          )}
        >
          <WeekBusinessSummaryData
            title={hubT("weekSummaryTitle")}
            linkLabel={hubT("openOverview")}
            copy={weekSummaryCopy}
          />
        </Suspense>
        {/* doc 27 §5.1 H2：原来是 xl:grid-cols-4，而 xl 生效时正文只有 976px，
            每列 226px 装不下"标题 + 一排操作按钮"。按正文容器判断，四列推到 @6xl。 */}
        <div className="grid grid-cols-1 gap-6 @2xl/page:grid-cols-2 @6xl/page:grid-cols-4 @6xl/page:items-start">
          {spotlightGroups.length > 0 ? (
            <WorkColumn title={t("nowTitle")}>
              <div className="flex flex-col gap-3">
                {spotlightGroups.map((group) => (
                  <WorkItemGroup
                    key={group[0].groupKey}
                    items={group}
                    getGroupHref={resolveWorkItemHref}
                    renderItemTitle={renderReason}
                    renderActions={renderActions}
                    bucketLabels={bucketLabels}
                  />
                ))}
              </div>
            </WorkColumn>
          ) : null}

          <WorkColumn title={t("myWorkTitle")}>
            <WorkItemList
              items={mine}
              getGroupHref={resolveWorkItemHref}
              renderItemTitle={renderReason}
              renderActions={renderActions}
              bucketLabels={bucketLabels}
              emptyMessage={t("myWorkEmpty")}
            />
          </WorkColumn>

          <WorkColumn title={t("todayTitle")}>
            {todaySessionData ? (
              <TeacherTodaySessions
                sessions={todaySessionData.sessions}
                timeZone={todaySessionData.timeZone}
                locale={locale}
                canMarkAttendance={perms.has("attendance.mark")}
                returnTo="/dashboard?view=work"
                compact
              />
            ) : todaySchedule.length > 0 ? (
              <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
                {todaySchedule.map((entry) => (
                  <li key={entry.groupKey}>
                    <Link
                      href={entry.href}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition hover:bg-line/20"
                    >
                      <span className="tabular-nums text-muted">{timeFmt.format(new Date(entry.scheduledAt))}</span>
                      <span className="min-w-0 flex-1 truncate px-3 text-ink">{entry.primaryObjectName}</span>
                      {entry.secondaryObjectName ? (
                        <span className="shrink-0 truncate text-xs text-muted">{entry.secondaryObjectName}</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t("todayEmpty")}</p>
            )}
          </WorkColumn>

          {hasManagementScope ? (
            <WorkColumn title={t("oversightTitle")}>
              <WorkItemList
                items={oversight}
                getGroupHref={resolveWorkItemHref}
                renderItemTitle={renderReason}
                renderActions={renderActions}
                bucketLabels={bucketLabels}
                emptyMessage={t("oversightAllClear")}
              />
            </WorkColumn>
          ) : null}
        </div>
        <WorkCoordinationPanel
          currentUserId={user.id}
          candidates={candidates}
          canManageWorkItems={canManageWorkItems}
        />
      </div>
    </ObjectWorkspace>
  );
}
