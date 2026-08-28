import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { listTeachingCalendarEntriesV2 } from "@/features/school/academic-calendar";
import { listSchoolYears } from "@/features/school/courses";
import { DashboardPage } from "@/features/school/dashboard-page";
import { getLocationCatalogV2, getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { calendarDayKey } from "@/features/school/schedule";
import { TeachingCalendarManager } from "@/features/school/TeachingCalendarManager";
import { TermManager } from "@/features/school/TermManager";
import { requirePerm } from "@/lib/auth";

export default async function AcademicCalendarPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl border border-line bg-card" />}>
      <AcademicCalendarBody locale={locale} />
    </Suspense>
  );
}

async function AcademicCalendarBody({ locale }: { locale: string }) {
  await requirePerm(locale, "schedule.manage");
  const [t, scheduleT, years, entries, campuses, timeZone] = await Promise.all([
    getTranslations("school.academicCalendar"),
    getTranslations("school.schedule"),
    listSchoolYears(),
    listTeachingCalendarEntriesV2(),
    getLocationCatalogV2(false),
    getOrganizationTimezoneV2(),
  ]);
  const activeYear = years.find((year) => year.status === "active") ?? null;
  const currentPeriod = years.flatMap((year) => year.periods).find((period) => period.isCurrent) ?? null;
  const today = calendarDayKey(new Date(), timeZone);

  return (
    <DashboardPage title={t("title")} description={t("intro")} meta={<span>{timeZone}</span>}>
      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-base font-medium text-ink">{t("yearsTitle")}</h2><p className="mt-1 max-w-3xl text-sm text-muted">{t("yearsIntro")}</p></div>
          <TermManager years={years} today={today} />
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-paper/45 p-3"><dt className="text-xs text-muted">{t("activeYearLabel")}</dt><dd className="mt-1 font-medium text-ink">{activeYear ? scheduleT("schoolYearName", { start: activeYear.startYear, end: activeYear.startYear + 1 }) : t("none")}</dd></div>
          <div className="rounded-xl bg-paper/45 p-3"><dt className="text-xs text-muted">{t("currentPeriodLabel")}</dt><dd className="mt-1 flex items-center gap-2 font-medium text-ink">{currentPeriod ? scheduleT(`period${currentPeriod.term}`) : t("none")}{currentPeriod ? <Badge variant="secondary">{scheduleT("currentSchoolPeriod")}</Badge> : null}</dd></div>
        </dl>
      </section>
      <TeachingCalendarManager entries={entries} campuses={campuses} today={today} />
    </DashboardPage>
  );
}
