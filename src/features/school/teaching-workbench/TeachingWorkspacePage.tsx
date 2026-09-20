import { ClassWorkspaceTabs } from "../ClassWorkspaceTabs";
import { ClassWorkspaceCommandPanel } from "../ClassWorkspaceCommandPanel";
import { ClassWorkspaceActions } from "../ClassWorkspaceActions";
import { workEntryMessages } from "../work-entry-contract";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage, DashboardSection } from "@/features/school/dashboard-page";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { WorkItemList } from "@/features/school/stage/WorkItemList";
import { WORK_ITEM_URGENCY_ORDER } from "@/features/school/stage/types";
import { hasTeachingManagementScope, TEACHING_WORKBENCH_PERMISSIONS } from "@/features/school/teaching-workbench/teaching-workbench-access";
import { teachingPeriodWindow, teachingWorkItems } from "@/features/school/teaching-workbench/teaching-workbench-contract";
import { getTeachingWorkbench } from "@/features/school/teaching-workbench/teaching-workbench-read";
import { TeachingProgressTable } from "@/features/school/teaching-workbench/TeachingProgressTable";
import { formatWorkItemReason, listMyWorkItems, resolveWorkItemHref } from "@/features/school/work-items";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { teachingTimeGrain, teachingTimeWindow } from "@/features/school/teaching-workbench/teaching-period-contract";
import { TeachingPeriodPicker } from "@/features/school/teaching-workbench/TeachingPeriodPicker";
import { listSchoolTerms } from "@/features/school/courses";
import { calendarDayKey } from "@/features/school/schedule";

type Query = Record<string, string | string[] | undefined>;

export default async function TeachingPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<Query>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("school.teachingWorkbench");
  return <Suspense fallback={<DashboardPage title={workEntryMessages(locale).classes}><p role="status" className="py-8 text-sm text-muted">{t("loading")}</p></DashboardPage>}>
    <TeachingContent locale={locale} searchParams={searchParams} />
  </Suspense>;
}

async function TeachingContent({ locale, searchParams }: { locale: string; searchParams: Promise<Query> }) {
  const user = await requireAnyPerm(locale, TEACHING_WORKBENCH_PERMISSIONS);
  const [query, perms, t, timeZone] = await Promise.all([
    searchParams, getMyPerms(user.id), getTranslations("school.teachingWorkbench"), getOrganizationTimezoneV2(),
  ]);
  const canViewTeam = hasTeachingManagementScope(perms);
  const view = query.view === "tasks" ? "tasks" : "progress";
  const period = teachingTimeGrain(query.period);
  const terms = view === "tasks" ? [] : await listSchoolTerms();
  const selection = typeof query.date === "string" ? query.date : "current";
  const selectedWindow = teachingTimeWindow(period, selection, typeof query.term === "string" ? query.term : undefined, terms, timeZone);
  const window = selectedWindow ?? teachingPeriodWindow("week", undefined, timeZone);
  const teacher = typeof query.teacher === "string" ? query.teacher : undefined;
  const classroom = typeof query.classroom === "string" ? query.classroom : undefined;
  const progressHref = (date = window.date, grain = period, target = view) => {
    const params = new URLSearchParams({ view: target, period: grain, date });
    if (teacher) params.set("teacher", teacher);
    if (classroom) params.set("classroom", classroom);
    if (typeof query.group === "string") params.set("group", query.group);
    if (grain === "term" && selectedWindow?.termId) params.set("term", selectedWindow.termId);
    return `/dashboard/classes?${params}`;
  };
  return <DashboardPage title={workEntryMessages(locale).classes} density="compact" commandPanel={
    <ClassWorkspaceCommandPanel
      navigation={<ClassWorkspaceTabs active={view} canTeach query={query} />}
      period={view !== "tasks" ? <TeachingPeriodPicker key={`${period}:${selection}:${selectedWindow?.termId ?? ""}`} grain={period} window={selectedWindow} baseHref={progressHref()} terms={terms} today={calendarDayKey(new Date(), timeZone)} /> : null}
      actions={<ClassWorkspaceActions canTeach query={query} />}
    />
  }>
    {view === "tasks" ? <TeachingTasks locale={locale} /> : !selectedWindow ? <p role="status" className="py-6 text-sm text-muted">{t("time.termUnavailable")}</p> : <TeachingProgress
      from={window.start} to={window.end} scope={canViewTeam ? "team" : "mine"}
      locale={locale} timeZone={timeZone} returnTo={progressHref()} teacher={teacher} classroom={classroom}
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
        params.set("returnTo", "/dashboard/classes?view=tasks");
        return `${path}?${params}`;
      }}
      renderItemTitle={item => formatWorkItemReason(item, tw, tc, locale, now)}
    />
  </DashboardSection>;
}

async function TeachingProgress({ from, to, scope, locale, timeZone, returnTo, teacher, classroom }: {
  from: string; to: string; scope: "mine" | "team"; locale: string; timeZone: string; returnTo: string;
  teacher?: string; classroom?: string;
}) {
  const t = await getTranslations("school.teachingWorkbench");
  let data;
  try { data = await getTeachingWorkbench(from, to, scope); }
  catch { return <p role="alert" className="py-6 text-sm text-rose">{t("loadFailed")}</p>; }
  return <TeachingProgressTable key={returnTo} data={data} locale={locale} timeZone={timeZone} now={new Date().toISOString()} returnTo={returnTo} mode="progress" initialTeacher={teacher} initialClassroom={classroom} />;
}
