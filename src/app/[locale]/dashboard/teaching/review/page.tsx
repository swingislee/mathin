import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { DashboardPage, DashboardCommandPanel, DashboardCommandState } from "@/features/school/dashboard-page";
import { RouteTabs } from "@/features/school/navigation/RouteTabs";
import { TeachingClassOverviewTable } from "@/features/school/teaching-workbench/TeachingClassOverviewTable";
import { TEACHING_REPLAY_ID, teachingReplayAllowed, teachingReplayOverview } from "@/features/school/teaching-workbench/teaching-replay-contract";
import { readTeachingReplay } from "@/features/school/teaching-workbench/teaching-replay-read";

export default async function TeachingReviewPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ teacher?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("school.teachingWorkbench");
  return <Suspense fallback={<DashboardPage title={t("title")}><p role="status" className="py-8 text-sm text-muted">{t("loading")}</p></DashboardPage>}>
    <ReviewContent locale={locale} searchParams={searchParams} />
  </Suspense>;
}

async function ReviewContent({ locale, searchParams }: { locale: string; searchParams: Promise<{ teacher?: string }> }) {
  const user = await requirePerm(locale, "class.view.all");
  if (!teachingReplayAllowed(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL, await getMyPerms(user.id))) notFound();
  const t = await getTranslations("school.teachingWorkbench");
  let snapshot;
  try { snapshot = await readTeachingReplay(locale); }
  catch { return <DashboardPage title={t("title")}><p role="alert" className="py-6 text-sm text-muted">{t("replay.unavailable")}</p></DashboardPage>; }
  const query = await searchParams;
  const teacher = snapshot.teachers.find(item => item.id === query.teacher)?.id;
  const href = "/dashboard/teaching/review";
  const captured = new Intl.DateTimeFormat(locale, { timeZone: snapshot.timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(snapshot.capturedAt));
  const data = teachingReplayOverview(snapshot);
  return <DashboardPage title={t("title")} density="compact" commandPanel={<DashboardCommandPanel className="followup-command-panel">
    <DashboardCommandState><RouteTabs ariaLabel={t("teacher")} activeValue={teacher ?? "all"} items={[
      { value: "all", label: t("replay.bothTeachers"), href },
      ...snapshot.teachers.map(item => ({ value: item.id, label: item.name, href: `${href}?teacher=${item.id}` })),
    ]} /><span className="text-xs text-muted">2026-09-07 — 2026-09-13 · {t("replay.source", { captured })}</span></DashboardCommandState>
  </DashboardCommandPanel>}>
    <p className="mb-2 text-xs leading-5 text-muted">{t("replay.hint")}</p>
    <TeachingClassOverviewTable key={teacher ?? "all"} data={data} locale={locale} timeZone={snapshot.timeZone} returnTo={href} initialTeacher={teacher} replayId={TEACHING_REPLAY_ID} />
  </DashboardPage>;
}
