import { ClassWorkspaceTabs } from "../ClassWorkspaceTabs";
import { ClassWorkspaceCommandPanel } from "../ClassWorkspaceCommandPanel";
import { ClassWorkspaceActions } from "../ClassWorkspaceActions";
import { workEntryMessages, classWorkHref } from "../work-entry-contract";
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
import { getTeachingRecords } from "@/features/school/teaching-workbench/teaching-records-read";
import { TeachingSessionRecords } from "@/features/school/teaching-workbench/TeachingSessionRecords";
import { getTeachingClassOverview } from "@/features/school/teaching-workbench/teaching-class-overview-read";
import { TeachingClassOverviewTable } from "@/features/school/teaching-workbench/TeachingClassOverviewTable";
import { formatWorkItemReason, listMyWorkItems, resolveWorkItemHref } from "@/features/school/work-items";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { teachingGrouping, type TeachingGrouping } from "@/features/school/teaching-workbench/teaching-grouping-contract";
import { teachingTimeGrain, teachingTimeWindow } from "@/features/school/teaching-workbench/teaching-period-contract";
import { TeachingPeriodPicker } from "@/features/school/teaching-workbench/TeachingPeriodPicker";
import { TeachingRecordsCommandPanel } from "@/features/school/teaching-workbench/TeachingRecordsCommandPanel";
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
  const view = query.view === "tasks" ? "tasks" : query.view === "progress" ? "progress" : query.view === "records" || canViewTeam ? "records" : "tasks";
  const period = teachingTimeGrain(query.period);
  const terms = view === "tasks" ? [] : await listSchoolTerms();
  const selection = typeof query.date === "string" ? query.date : view === "records" ? "previous" : "current";
  const selectedWindow = teachingTimeWindow(period, selection, typeof query.term === "string" ? query.term : undefined, terms, timeZone);
  const window = selectedWindow ?? teachingPeriodWindow("week", undefined, timeZone);
  const teacher = typeof query.teacher === "string" ? query.teacher : undefined;
  const classroom = typeof query.classroom === "string" ? query.classroom : undefined;
  const groupBy = teachingGrouping(query.group);
  const progressHref = (date = window.date, grain = period, target = view) => {
    const params = new URLSearchParams({ view: target, period: grain, date });
    if (teacher) params.set("teacher", teacher);
    if (classroom) params.set("classroom", classroom);
    params.set("group", groupBy);
    if (grain === "term" && selectedWindow?.termId) params.set("term", selectedWindow.termId);
    return `/dashboard/classes?${params}`;
  };
  const sessionId = typeof query.session === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.session) ? query.session : undefined;
  const contactPage = typeof query.contactPage === "string" && /^\d{1,5}$/.test(query.contactPage) ? Math.max(1, Number(query.contactPage)) : 1;
  const contactSize = query.contactSize === "10" ? 10 : 20;

  return <DashboardPage title={workEntryMessages(locale).classes} density="compact" commandPanel={view === "records" && !sessionId ?
    <TeachingRecordsCommandPanel navigation={<ClassWorkspaceTabs active="records" canTeach query={query} />} groupBy={groupBy} grain={period} window={selectedWindow} baseHref={progressHref(selection)} terms={terms} today={calendarDayKey(new Date(), timeZone)} selection={selection} links={[
      { value: "tasks", label: t("myTasks"), href: classWorkHref("tasks", query) },
      { value: "progress", label: t(canViewTeam ? "teamProgress" : "myProgress"), href: progressHref(selection, period, "progress") },
      { value: "allWork", label: t("allWork"), href: "/dashboard?view=work" },
    ]} /> :
    <ClassWorkspaceCommandPanel
      navigation={<ClassWorkspaceTabs active={view} canTeach query={query} />}
      period={view !== "tasks" && !(view === "records" && sessionId) ? <TeachingPeriodPicker key={`${period}:${selection}:${selectedWindow?.termId ?? ""}`} grain={period} window={selectedWindow} baseHref={progressHref()} terms={terms} today={calendarDayKey(new Date(), timeZone)} /> : null}
      actions={<ClassWorkspaceActions canTeach query={query} />}
    />
  }>
    {view === "tasks" ? <TeachingTasks locale={locale} /> : view === "records" && sessionId ? <TeachingRecordDetail
      sessionId={sessionId} contactPage={contactPage} pageSize={contactSize} locale={locale} timeZone={timeZone} returnTo={progressHref()}
    /> : !selectedWindow ? <p role="status" className="py-6 text-sm text-muted">{t("time.termUnavailable")}</p> : <TeachingProgress
      from={window.start} to={window.end} scope={canViewTeam ? "team" : "mine"}
      locale={locale} timeZone={timeZone} returnTo={progressHref()} mode={view} teacher={teacher} classroom={classroom} groupBy={groupBy}
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

async function TeachingProgress({ from, to, scope, locale, timeZone, returnTo, mode, teacher, classroom, groupBy }: {
  from: string; to: string; scope: "mine" | "team"; locale: string; timeZone: string; returnTo: string;
  mode: "progress" | "records"; teacher?: string; classroom?: string; groupBy: TeachingGrouping;
}) {
  const t = await getTranslations("school.teachingWorkbench");
  if (mode === "records") {
    let overview;
    try { overview = await getTeachingClassOverview(from, to, scope); }
    catch { return <p role="alert" className="py-6 text-sm text-rose">{t("loadFailed")}</p>; }
    return <>
      <p className="mb-2 text-xs leading-5 text-muted">{t("replay.hint")}</p>
      <TeachingClassOverviewTable key={returnTo} data={overview} locale={locale} timeZone={timeZone} returnTo={returnTo} initialTeacher={teacher} initialClassroom={classroom} groupBy={groupBy} />
    </>;
  }
  let data;
  try { data = await getTeachingWorkbench(from, to, scope); }
  catch { return <p role="alert" className="py-6 text-sm text-rose">{t("loadFailed")}</p>; }
  return <TeachingProgressTable key={returnTo} data={data} locale={locale} timeZone={timeZone} now={new Date().toISOString()} returnTo={returnTo} mode={mode} initialTeacher={teacher} initialClassroom={classroom} />;
}

async function TeachingRecordDetail({ sessionId, contactPage, pageSize, locale, timeZone, returnTo }: {
  sessionId: string; contactPage: number; pageSize: 10 | 20; locale: string; timeZone: string; returnTo: string;
}) {
  const t = await getTranslations("school.teachingWorkbench");
  let data;
  try { data = await getTeachingRecords(sessionId, contactPage, pageSize); }
  catch { return <div className="space-y-3 py-6"><p role="alert" className="text-sm text-rose">{t("records.loadFailed")}</p><Link href={returnTo} className="text-sm underline">{t("records.back")}</Link></div>; }
  return <TeachingSessionRecords data={data} locale={locale} timeZone={timeZone} returnTo={returnTo} pageSize={pageSize} currentHref={`${returnTo}&session=${sessionId}&contactSize=${pageSize}`} />;
}
