import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { FollowUpBoardList } from "@/features/school/FollowUpBoardList";
import {
  BOARD_BUCKETS,
  listFollowUpBoard,
  parseBoardParams,
  type BoardBucket,
  type FollowUpBoard,
} from "@/features/school/followups";
import { NewStudentDialog } from "@/features/school/NewStudentDialog";
import { FOLLOW_UP_STATUSES } from "@/features/school/students";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

const EMPTY_BOARD: FollowUpBoard = {
  counts: { overdue: 0, today: 0, week: 0, unscheduled: 0, trialToday: 0, renewal:0, lost:0 },
  groups: FOLLOW_UP_STATUSES.map((status) => ({ status, rows: [] })),
};

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function FollowUpsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requirePerm(locale, "followup.view");
  const t = await getTranslations("school.followups");
  const perms = await getMyPerms(user.id);
  const canScopeAll = perms.has("student.view.all");
  const canCreate = perms.has("student.create");
  const canEditStatus = perms.has("student.edit");
  const canOrder = perms.has("finance.order.create");

  const { scope, bucket } = parseBoardParams(rawSearchParams, canScopeAll);
  const board = await safe(() => listFollowUpBoard(user.id, scope, bucket), EMPTY_BOARD);

  const boardHref = (next: { scope?: typeof scope; bucket?: BoardBucket | undefined }) => {
    const query = new URLSearchParams();
    const nextScope = "scope" in next ? next.scope : scope;
    const nextBucket = "bucket" in next ? next.bucket : bucket;
    if (nextScope === "all") query.set("scope", "all");
    if (nextBucket) query.set("bucket", nextBucket);
    const qs = query.toString();
    return `/dashboard/followups${qs ? `?${qs}` : ""}`;
  };

  return (
    <DashboardPage
      title={t("title")}
      commandPanel={
        <DashboardCommandPanel>
          {canScopeAll ? (
            <DashboardCommandState>
              <DashboardCommandTabs
                ariaLabel={t("scopeLabel")}
                activeValue={scope}
                items={[
                  { value: "mine", label: t("scopeMine"), href: boardHref({ scope: "mine" }) },
                  { value: "all", label: t("scopeAll"), href: boardHref({ scope: "all" }) },
                ]}
              />
            </DashboardCommandState>
          ) : null}

          {/*
            七个时间桶带计数。doc 24 §3.1 之前这里是 `overflow-x-auto`，理由是"换行会让
            命令面板长到小半屏"——但实测 390px 下七个桶横向滚动时后四个（本周/未排期/
            续费/流失）完全在视野外，而这一页的用户就是靠"逾期几条"决定今天先打哪通电话。
            换行只多一行 32px，滚动却是直接把一半量表藏起来。
          */}
          <DashboardCommandFilters>
            <div role="group" aria-label={t("title")} className="flex min-w-0 flex-wrap items-center gap-1">
              {BOARD_BUCKETS.map((key) => {
                const active = bucket === key;
                const rose = key === "overdue" && board.counts[key] > 0;
                return (
                  <Link
                    key={key}
                    href={boardHref({ bucket: active ? undefined : key })}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs transition",
                      active ? "bg-crater/12 font-medium text-ink" : "text-muted hover:bg-paper/80 hover:text-ink",
                    )}
                  >
                    <span>{t(`bucket_${key}`)}</span>
                    <span className={cn("tabular-nums", rose ? "text-rose" : "")}>{board.counts[key]}</span>
                  </Link>
                );
              })}
            </div>
          </DashboardCommandFilters>

          {canCreate ? (
            <DashboardCommandActions>
              <NewStudentDialog />
            </DashboardCommandActions>
          ) : null}
        </DashboardCommandPanel>
      }
    >
      <FollowUpBoardList groups={board.groups} canEditStatus={canEditStatus} canOrder={canOrder} canRecover={canEditStatus&&perms.has("followup.write")} returnTo={boardHref({})} />
    </DashboardPage>
  );
}
