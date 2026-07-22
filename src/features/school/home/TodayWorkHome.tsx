import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { ObjectBar } from "@/features/school/stage/ObjectBar";
import { ObjectWorkspace } from "@/features/school/stage/ObjectWorkspace";
import { StatusStrip, type StatusStripItem } from "@/features/school/stage/StatusStrip";
import { WorkItemActions } from "@/features/school/stage/WorkItemActions";
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
import { getMyPerms } from "@/lib/auth";
import type { HomeProps } from "./shared";

// P4I-17（docs/plan/19-p4i-final.md §22）：今日工作从 P4I-8 的只读试用页
// 转正为 staff 默认首页，接入 5 个真实动作（已读/稍后处理/置顶/确认/关注，
// P4I-6 建的 RPC，见 WorkItemActions.tsx）。分区结构/数据推导原样沿用
// P4I-8（`selectSpotlightGroups`/`partitionByOwnership`/`selectTodaySchedule`）。

// 四个工作分区在宽屏下并排成列（最多 4 列），而不是各自占满整行——避免每张
// 工作卡横向铺满整个视口、内容却只占一小块的观感问题（P4I-8 真实试用反馈）。
function WorkColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{title}</h2>
      {children}
    </section>
  );
}

async function safeListMyWorkItems(): Promise<WorkItemRow[]> {
  try {
    return await listMyWorkItems();
  } catch {
    return [];
  }
}

export async function TodayWorkHome({ locale, user, profile }: HomeProps) {
  const [schoolT, t, tClasses, perms, items] = await Promise.all([
    getTranslations("school"),
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
  const dateLine = new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(now);
  const greeting = `${schoolT("home.staffGreeting", { name: profile?.displayName || "" })} · ${dateLine}`;

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

  return (
    <ObjectWorkspace objectBar={<ObjectBar title={t("title")} context={greeting} />} statusStrip={<StatusStrip items={statusItems} />}>
      <div className="mx-auto w-full max-w-[96rem] space-y-6">
        <p className="text-sm text-muted">{t("intro")}</p>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4 xl:items-start">
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
      </div>
    </ObjectWorkspace>
  );
}
