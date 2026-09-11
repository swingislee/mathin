import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { DashboardPage, DashboardCommandPanel, DashboardCommandState, DashboardCommandFilters, DashboardCommandActions, DashboardSection } from "@/features/school/dashboard-page";
import { RouteTabs } from "@/features/school/navigation/RouteTabs";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { WorkItemList } from "@/features/school/stage/WorkItemList";
import { WORK_ITEM_URGENCY_ORDER } from "@/features/school/stage/types";
import { hasTeachingManagementScope, TEACHING_WORKBENCH_PERMISSIONS } from "@/features/school/teaching-workbench/teaching-workbench-access";
import { teachingPeriodWindow, teachingWorkItems } from "@/features/school/teaching-workbench/teaching-workbench-contract";
import { getTeachingWorkbench } from "@/features/school/teaching-workbench/teaching-workbench-read";
import { TeachingProgressTable } from "@/features/school/teaching-workbench/TeachingProgressTable";
import { formatWorkItemReason, listMyWorkItems, resolveWorkItemHref } from "@/features/school/work-items";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";

type Query = Record<string, string | string[] | undefined>;

export default async function TeachingPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<Query>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("school.teachingWorkbench");
  return <Suspense fallback={<DashboardPage title={t("title")}><p role="status" className="py-8 text-sm text-muted">{t("loading")}</p></DashboardPage>}>
    <TeachingContent locale={locale} searchParams={searchParams} />
  </Suspense>;
}

async function TeachingContent({ locale, searchParams }: { locale: string; searchParams: Promise<Query> }) {
  const user = await requireAnyPerm(locale, TEACHING_WORKBENCH_PERMISSIONS);
  const [query, perms, t, timeZone] = await Promise.all([
    searchParams, getMyPerms(user.id), getTranslations("school.teachingWorkbench"), getOrganizationTimezoneV2(),
  ]);
  const canViewTeam = hasTeachingManagementScope(perms);
  const view = query.view === "tasks" ? "tasks" : query.view === "progress" || canViewTeam ? "progress" : "tasks";
  const period = query.period === "month" ? "month" : "week";
  const window = teachingPeriodWindow(period, typeof query.date === "string" ? query.date : undefined, timeZone);
  const progressHref = (date = window.date, grain = period) => `/dashboard/teaching?view=progress&period=${grain}&date=${date}`;

  return <DashboardPage title={t("title")} density="compact" commandPanel={
    <DashboardCommandPanel>
      <DashboardCommandState>
        <RouteTabs ariaLabel={t("views")} activeValue={view} items={[
          { value: "tasks", label: t("myTasks"), href: "/dashboard/teaching?view=tasks" },
          { value: "progress", label: t(canViewTeam ? "teamProgress" : "myProgress"), href: progressHref() },
        ]} />
      </DashboardCommandState>
      <DashboardCommandFilters>
        {view === "progress" && <>
          <RouteTabs ariaLabel={t("period")} activeValue={period} items={[
            { value: "week", label: t("week"), href: progressHref(window.date, "week") },
            { value: "month", label: t("month"), href: progressHref(window.date, "month") },
          ]} />
          <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={progressHref(window.previous)}>{t("previous")}</Link>
          <span className="text-xs tabular-nums text-muted">{window.date} — {window.lastDate}</span>
          <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={progressHref(window.next)}>{t("next")}</Link>
          <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/dashboard/teaching?view=progress&period=${period}`}>{t("current")}</Link>
        </>}
      </DashboardCommandFilters>
      <DashboardCommandActions><Link className={buttonVariants({ variant: "secondary", size: "sm" })} href="/dashboard?view=work">{t("allWork")}</Link></DashboardCommandActions>
    </DashboardCommandPanel>
  }>
    {view === "tasks" ? <TeachingTasks locale={locale} /> : <TeachingProgress
      from={window.start} to={window.end} scope={canViewTeam ? "team" : "mine"}
      locale={locale} timeZone={timeZone} returnTo={progressHref()}
    />}
  </DashboardPage>;
}

async function TeachingTasks({ locale }: { locale: string }) {
  const [t, tw, tc] = await Promise.all([getTranslations("school.teachingWorkbench"), getTranslations("school.work"), getTranslations("school.classes")]);
  let items;
  try { items = teachingWorkItems(await listMyWorkItems()); }
  catch { return <p role="alert" className="py-6 text-sm text-rose">{t("loadFailed")}</p>; }
  const now = new Date();
  return <DashboardSection title={t("myTasks")} description={t("tasksHint")}>
    <WorkItemList items={items} emptyMessage={t("emptyTasks")}
      bucketLabels={Object.fromEntries(WORK_ITEM_URGENCY_ORDER.map(bucket => [bucket, tw(`bucket_${bucket}`)]))}
      getGroupHref={item => {
        const href = resolveWorkItemHref(item);
        const [path, rawQuery] = href.split("?");
        const params = new URLSearchParams(rawQuery);
        params.set("returnTo", "/dashboard/teaching?view=tasks");
        return `${path}?${params}`;
      }}
      renderItemTitle={item => formatWorkItemReason(item, tw, tc, locale, now)}
    />
  </DashboardSection>;
}

async function TeachingProgress({ from, to, scope, locale, timeZone, returnTo }: {
  from: string; to: string; scope: "mine" | "team"; locale: string; timeZone: string; returnTo: string;
}) {
  const t = await getTranslations("school.teachingWorkbench");
  let data;
  try { data = await getTeachingWorkbench(from, to, scope); }
  catch { return <p role="alert" className="py-6 text-sm text-rose">{t("loadFailed")}</p>; }
  return <TeachingProgressTable key={returnTo} data={data} locale={locale} timeZone={timeZone} now={new Date().toISOString()} returnTo={returnTo} />;
}
