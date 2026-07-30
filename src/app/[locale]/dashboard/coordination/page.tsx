import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { NotificationFocus } from "@/features/events/NotificationFocus";
import { listCoordinationHistory } from "@/features/school/coordination-history";
import { DashboardCard, DashboardPage } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { requireDashboardEnvironment } from "@/lib/auth";
import { cn } from "@/lib/utils";

export default async function CoordinationHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("school.coordinationHistory");
  return (
    <DashboardPage title={t("title")}>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl border border-line bg-card" />}>
        <CoordinationHistoryContent locale={locale} searchParams={searchParams} />
      </Suspense>
    </DashboardPage>
  );
}

async function CoordinationHistoryContent({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  await requireDashboardEnvironment(locale, ["staff"]);
  const [history, rawSearchParams, t] = await Promise.all([
    listCoordinationHistory(),
    searchParams,
    getTranslations("school.coordinationHistory"),
  ]);
  const focusTarget = typeof rawSearchParams.focus === "string" && rawSearchParams.focus.length <= 200
    ? rawSearchParams.focus
    : undefined;
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="space-y-6">
      <NotificationFocus target={focusTarget} />
      <p className="max-w-3xl text-sm text-muted">{t("intro")}</p>
      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        <DashboardCard title={t("workItemsTitle")} description={t("workItemsIntro")}>
          {history.workItems.length === 0 ? (
            <p className="text-sm text-muted">{t("emptyWorkItems")}</p>
          ) : (
            <ol className="divide-y divide-line">
              {history.workItems.map((item) => (
                <li
                  key={item.id}
                  data-notification-target={"durable:" + item.id}
                  tabIndex={-1}
                  className="space-y-2 py-4 outline-none transition"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-medium text-ink">{item.title}</h2>
                      <p className="mt-1 text-xs text-muted">{t("createdMeta", { creator: item.creatorName, assignee: item.assigneeName })}</p>
                    </div>
                    <Badge variant={item.status === "open" ? "default" : "outline"}>{t("workStatus_" + item.status)}</Badge>
                  </div>
                  <p className="text-sm text-ink">{item.createdReason}</p>
                  {item.description ? <p className="text-sm text-muted">{item.description}</p> : null}
                  {item.closedReason ? <p className="rounded-lg bg-line/20 px-3 py-2 text-sm text-muted">{t("closedReason", { reason: item.closedReason })}</p> : null}
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
                    <time>{dateTime.format(new Date(item.closedAt ?? item.createdAt))}</time>
                    {item.status === "open" ? (
                      <Link href={"/dashboard?focus=durable:" + item.id} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                        {t("openWorkItem")}
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </DashboardCard>

        <DashboardCard title={t("approvalsTitle")} description={t("approvalsIntro")}>
          {history.approvals.length === 0 ? (
            <p className="text-sm text-muted">{t("emptyApprovals")}</p>
          ) : (
            <ol className="divide-y divide-line">
              {history.approvals.map((approval) => (
                <li
                  key={approval.id}
                  data-notification-target={"approval:" + approval.id}
                  tabIndex={-1}
                  className="space-y-2 py-4 outline-none transition"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-medium text-ink">{approval.title}</h2>
                      <p className="mt-1 text-xs text-muted">{t("approvalMeta", { requester: approval.requesterName, approver: approval.approverName })}</p>
                    </div>
                    <Badge variant={approval.decision === "rejected" ? "danger" : approval.decision === "approved" ? "secondary" : "default"}>
                      {approval.decision ? t("decision_" + approval.decision) : t("approvalStatus_pending")}
                    </Badge>
                  </div>
                  <p className="text-sm text-ink">{approval.requestReason}</p>
                  {approval.decisionReason ? <p className="rounded-lg bg-line/20 px-3 py-2 text-sm text-muted">{t("decisionReason", { reason: approval.decisionReason })}</p> : null}
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
                    <time>{dateTime.format(new Date(approval.decidedAt ?? approval.createdAt))}</time>
                    {!approval.decision ? (
                      <Link href={"/dashboard?focus=approval:" + approval.id} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                        {t("openApproval")}
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </DashboardCard>
      </div>
    </div>
  );
}
