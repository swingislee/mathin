import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { listTeachingCalendarEntriesV2 } from "@/features/school/academic-calendar";
import { listSchoolYears } from "@/features/school/courses";
import { DashboardPage } from "@/features/school/dashboard-page";
import {
  getLocationCatalogV2,
  getOrganizationTimezoneV2,
  getScheduleDefaultsV2,
} from "@/features/school/organization-locations";
import { calendarDayKey } from "@/features/school/schedule";
import { ScheduleDefaultsForm } from "@/features/school/ScheduleDefaultsForm";
import { TeachingCalendarManager } from "@/features/school/TeachingCalendarManager";
import { TermManager } from "@/features/school/TermManager";
import { requirePerm } from "@/lib/auth";

export default async function AcademicYearsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<AcademicYearsSkeleton />}>
      <AcademicYearsBody locale={locale} />
    </Suspense>
  );
}

function AcademicYearsSkeleton() {
  return (
    <div className="space-y-8 pt-5" aria-hidden>
      <div className="h-28 animate-pulse rounded-2xl bg-card/35" />
      <div className="h-64 animate-pulse rounded-2xl bg-card/35" />
      <div className="h-40 animate-pulse rounded-2xl bg-card/35" />
    </div>
  );
}

async function AcademicYearsBody({ locale }: { locale: string }) {
  await requirePerm(locale, "schedule.manage");
  const [t, scheduleT, years, entries, campuses, timeZone, defaults] = await Promise.all([
    getTranslations("school.academicCalendar"),
    getTranslations("school.schedule"),
    listSchoolYears(),
    listTeachingCalendarEntriesV2(),
    getLocationCatalogV2(false),
    getOrganizationTimezoneV2(),
    getScheduleDefaultsV2(),
  ]);
  const activeYear = years.find((year) => year.status === "active") ?? null;
  const currentPeriod = years.flatMap((year) => year.periods).find((period) => period.isCurrent) ?? null;
  const today = calendarDayKey(new Date(), timeZone);

  return (
    <DashboardPage title={t("title")} description={t("intro")} meta={<span>{timeZone}</span>} density="comfortable">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h2 className="text-base font-medium text-ink">{t("yearsTitle")}</h2>
            <p className="mt-1 text-sm text-muted">{t("yearsIntro")}</p>
          </div>
          <TermManager years={years} today={today} />
        </div>
        <dl className="mt-5 grid gap-4 text-sm">
          <div className="grid gap-1 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-center">
            <dt className="text-muted">{t("activeYearLabel")}</dt>
            <dd className="font-medium text-ink">
              {activeYear ? scheduleT("schoolYearName", { start: activeYear.startYear, end: activeYear.startYear + 1 }) : t("none")}
            </dd>
          </div>
          <div className="grid gap-1 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-center">
            <dt className="text-muted">{t("currentPeriodLabel")}</dt>
            <dd className="flex items-center gap-2 font-medium text-ink">
              {currentPeriod ? scheduleT(`period${currentPeriod.term}`) : t("none")}
              {currentPeriod ? <Badge variant="secondary">{scheduleT("currentSchoolPeriod")}</Badge> : null}
            </dd>
          </div>
        </dl>
      </section>

      <TeachingCalendarManager entries={entries} campuses={campuses} today={today} />
      <ScheduleDefaultsForm defaults={defaults} />
    </DashboardPage>
  );
}
