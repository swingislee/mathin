import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import {
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { requirePerm } from "@/lib/auth";
import { CourseFamilyFilters } from "@/features/school/teaching-operations/CourseFamilyFilters";
import { CourseFamilyList } from "@/features/school/teaching-operations/CourseFamilyList";
import { listCourseFamilies, parseCourseFamilyFilters } from "@/features/school/teaching-operations/course-queries";

export default async function CoursesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("school.courses");
  return (
    <DashboardPage
      title={t("title")}
      commandPanel={
        <Suspense fallback={<DashboardCommandPanel />}>
          <CourseFamilyCommandPanel locale={locale} searchParams={searchParams} />
        </Suspense>
      }
    >
      <Suspense fallback={<div className="h-56 animate-pulse rounded-2xl border border-line bg-card" />}>
        <CourseFamilyLibrary locale={locale} searchParams={searchParams} />
      </Suspense>
    </DashboardPage>
  );
}

async function CourseFamilyCommandPanel({ locale, searchParams }: { locale: string; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [rawSearchParams] = await Promise.all([searchParams, requirePerm(locale, "course.view")]);
  return (
    <DashboardCommandPanel>
      <DashboardCommandFilters>
        <CourseFamilyFilters filters={parseCourseFamilyFilters(rawSearchParams)} />
      </DashboardCommandFilters>
    </DashboardCommandPanel>
  );
}

async function CourseFamilyLibrary({ locale, searchParams }: { locale: string; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [rawSearchParams] = await Promise.all([searchParams, requirePerm(locale, "course.view")]);
  const filters = parseCourseFamilyFilters(rawSearchParams);
  const { families, totalCount } = await listCourseFamilies(filters);
  const hasFilters = Boolean(filters.q || filters.grade || filters.courseSeason || filters.classType || filters.familyStatus || filters.variantStatus || filters.purpose || filters.readiness);
  return <CourseFamilyList families={families} totalCount={totalCount} hasFilters={hasFilters} resetHref="/dashboard/courses" />;
}
