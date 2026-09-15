import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { DashboardPage, DashboardCommandPanel, DashboardCommandState, DashboardCommandFilters } from "@/features/school/dashboard-page";
import { RouteTabs } from "@/features/school/navigation/RouteTabs";
import { TeachingClassOverviewTable } from "@/features/school/teaching-workbench/TeachingClassOverviewTable";
import { TEACHING_REPLAY_ID, selectTeachingReplay, teachingReplayAllowed, teachingReplayOverview } from "@/features/school/teaching-workbench/teaching-replay-contract";
import { readTeachingReplay } from "@/features/school/teaching-workbench/teaching-replay-read";
import { teachingGrouping } from "@/features/school/teaching-workbench/teaching-grouping-contract";
import { teachingTimeGrain, teachingTimeWindow } from "@/features/school/teaching-workbench/teaching-period-contract";
import { TeachingPeriodPicker } from "@/features/school/teaching-workbench/TeachingPeriodPicker";
import { calendarDayKey } from "@/features/school/schedule";

type ReviewQuery = { group?: string; period?: string; date?: string; term?: string };

export default async function TeachingReviewPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<ReviewQuery>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("school.teachingWorkbench");
  return <Suspense fallback={<DashboardPage title={t("title")}><p role="status" className="py-8 text-sm text-muted">{t("loading")}</p></DashboardPage>}>
    <ReviewContent locale={locale} searchParams={searchParams} />
  </Suspense>;
}

async function ReviewContent({ locale, searchParams }: { locale: string; searchParams: Promise<ReviewQuery> }) {
  const user = await requirePerm(locale, "class.view.all");
  if (!teachingReplayAllowed(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL, await getMyPerms(user.id))) notFound();
  const t = await getTranslations("school.teachingWorkbench");
  let snapshot;
  try { snapshot = await readTeachingReplay(locale); }
  catch { return <DashboardPage title={t("title")}><p role="alert" className="py-6 text-sm text-muted">{t("replay.unavailable")}</p></DashboardPage>; }
  const query = await searchParams;
  const groupBy = teachingGrouping(query.group);
  const grain = teachingTimeGrain(query.period);
  const selection = query.date ?? "previous";
  const window = teachingTimeWindow(grain, selection, query.term, snapshot.terms, snapshot.timeZone);
  const href = "/dashboard/teaching/review";
  const groupedHref = (group = groupBy) => {
    const params = new URLSearchParams({ group, period: grain, date: selection });
    if (query.term) params.set("term", query.term);
    return `${href}?${params}`;
  };
  const captured = new Intl.DateTimeFormat(locale, { timeZone: snapshot.timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(snapshot.capturedAt));
  const selected = window ? selectTeachingReplay(snapshot, window) : null;
  const data = selected ? teachingReplayOverview(selected.snapshot) : null;
  return <DashboardPage title={t("title")} density="compact" commandPanel={<DashboardCommandPanel className="followup-command-panel">
    <DashboardCommandState><RouteTabs ariaLabel={t("grouping.title")} activeValue={groupBy} items={[
      { value: "grade", label: t("grouping.byGrade"), href: groupedHref("grade") },
      { value: "teacher", label: t("grouping.byTeacher"), href: groupedHref("teacher") },
    ]} /></DashboardCommandState>
    <DashboardCommandFilters><TeachingPeriodPicker key={`${grain}:${selection}:${query.term ?? ""}`} grain={grain} window={window} baseHref={groupedHref()} terms={snapshot.terms} today={calendarDayKey(new Date(), snapshot.timeZone)} /></DashboardCommandFilters>
  </DashboardCommandPanel>}>
    <div className="mb-2 flex flex-wrap justify-between gap-x-4 text-xs leading-5 text-muted"><p>{t("replay.hint")}</p><p>{t("replay.source", { captured })}</p></div>
    {selected && selected.coverage !== "full" && <p role="status" className="mb-3 text-xs text-muted" data-teaching-coverage={selected.coverage}>{t(selected.beforeStart ? "time.beforeStart" : selected.coverage === "none" ? "time.snapshotNone" : snapshot.startedOn && window!.date < snapshot.startedOn ? "time.snapshotSinceStart" : "time.snapshotPartial", { from: calendarDayKey(new Date(snapshot.from), snapshot.timeZone), to: calendarDayKey(new Date(Date.parse(snapshot.to) - 1), snapshot.timeZone), startedOn: snapshot.startedOn ?? "" })}</p>}
    {data && window && selected?.coverage !== "none" ? <TeachingClassOverviewTable key={`${groupBy}:${window.start}:${window.end}`} data={data} locale={locale} timeZone={snapshot.timeZone} returnTo={groupedHref()} replayId={TEACHING_REPLAY_ID} groupBy={groupBy} replayFrom={window.start} replayTo={window.end} />
      : !window && <p role="status" className="py-6 text-sm text-muted">{t("time.termUnavailable")}</p>}
  </DashboardPage>;
}
