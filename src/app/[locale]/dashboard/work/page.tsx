import { getTranslations, setRequestLocale } from "next-intl/server";
import { ObjectBar } from "@/features/school/stage/ObjectBar";
import { ObjectWorkspace } from "@/features/school/stage/ObjectWorkspace";
import { StatusStrip, type StatusStripItem } from "@/features/school/stage/StatusStrip";
import { WorkItemGroup } from "@/features/school/stage/WorkItemGroup";
import { WorkItemList } from "@/features/school/stage/WorkItemList";
import type { WorkItemRow } from "@/features/school/stage/types";
import {
  formatWorkItemReason,
  listMyWorkItems,
  partitionByOwnership,
  resolveWorkItemHref,
  selectSpotlightGroups,
  selectTodaySchedule,
} from "@/features/school/work-items";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireStaff } from "@/lib/auth";

// P4I-8（docs/plan/19-p4i-final.md §6-7/§22）：今日工作只读试用。只做展示 +
// 只读跳转，不接 snooze/pin/acknowledge/watch——这是 doc19 的停止条件任务，
// 交给真实账号判断排序/分组是否符合工作直觉后再决定是否继续 P4I-9。

async function safeListMyWorkItems(): Promise<WorkItemRow[]> {
  try {
    return await listMyWorkItems();
  } catch {
    return [];
  }
}

export default async function WorkPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireStaff(locale);

  const [t, tClasses, perms, items] = await Promise.all([
    getTranslations("school.work"),
    getTranslations("school.classes"),
    getMyPerms(user.id),
    safeListMyWorkItems(),
  ]);

  const hasManagementScope =
    perms.has("class.manage") || perms.has("class.view.all") || perms.has("student.view.all") || perms.has("finance.refund.approve");

  const now = new Date();
  const spotlightGroups = selectSpotlightGroups(items);
  const { mine, oversight } = partitionByOwnership(items);
  const todaySchedule = selectTodaySchedule(items, now);
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });

  const renderReason = (item: WorkItemRow) => (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>{formatWorkItemReason(item, t, tClasses, locale, now)}</span>
      {item.ownershipMode === "delegated" ? <span className="text-[11px] text-muted">{t("delegatedTag")}</span> : null}
    </span>
  );

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

  return (
    <ObjectWorkspace objectBar={<ObjectBar title={t("title")} />} statusStrip={<StatusStrip items={statusItems} />}>
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <p className="text-sm text-muted">{t("intro")}</p>

        {spotlightGroups.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{t("nowTitle")}</h2>
            <div className="flex flex-col gap-3">
              {spotlightGroups.map((group) => (
                <WorkItemGroup
                  key={group[0].groupKey}
                  items={group}
                  getGroupHref={resolveWorkItemHref}
                  renderItemTitle={renderReason}
                  bucketLabels={bucketLabels}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{t("myWorkTitle")}</h2>
          <WorkItemList
            items={mine}
            getGroupHref={resolveWorkItemHref}
            renderItemTitle={renderReason}
            bucketLabels={bucketLabels}
            emptyMessage={t("myWorkEmpty")}
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{t("todayTitle")}</h2>
          {todaySchedule.length > 0 ? (
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
        </section>

        {hasManagementScope ? (
          <section className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{t("oversightTitle")}</h2>
            <WorkItemList
              items={oversight}
              getGroupHref={resolveWorkItemHref}
              renderItemTitle={renderReason}
              bucketLabels={bucketLabels}
              emptyMessage={t("oversightAllClear")}
            />
          </section>
        ) : null}
      </div>
    </ObjectWorkspace>
  );
}
