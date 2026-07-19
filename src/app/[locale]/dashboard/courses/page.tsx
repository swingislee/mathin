import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { CourseFamilyFilters } from "@/features/school/teaching-operations/CourseFamilyFilters";
import { CourseFamilyList } from "@/features/school/teaching-operations/CourseFamilyList";
import { CourseScopeSwitch } from "@/features/school/teaching-operations/CourseScopeSwitch";
import { availableCourseScopes, listCourseFamilies, parseCourseFamilyFilters, resolveCourseScope } from "@/features/school/teaching-operations/course-queries";

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
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader title={t("title")}>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("libraryIntro")}</p>
      </SchoolPageHeader>
      <Suspense fallback={<div className="mt-6 h-56 animate-pulse rounded-2xl border border-line bg-card" />}><CourseFamilyLibrary locale={locale} searchParams={searchParams} /></Suspense>
    </div>
  );
}

async function CourseFamilyLibrary({ locale, searchParams }: { locale: string; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [rawSearchParams, user] = await Promise.all([searchParams, requirePerm(locale, "course.view")]);
  const permissions = await getMyPerms(user.id);
  const filters = parseCourseFamilyFilters(rawSearchParams);
  const scope = resolveCourseScope(rawSearchParams.scope, permissions);
  const [{ families, totalCount }, t] = await Promise.all([listCourseFamilies(scope, filters), getTranslations("school.courses")]);
  const resetHref = `/dashboard/courses?scope=${scope}`;
  const hasFilters = Boolean(filters.q || filters.grade || filters.courseSeason || filters.classType || filters.familyStatus || filters.variantStatus || filters.purpose || filters.readiness);
  return <section className="mt-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-medium text-ink">{t("scopeLabel")}</p><CourseScopeSwitch activeScope={scope} availableScopes={availableCourseScopes(permissions)} /></div>
    <CourseFamilyFilters filters={filters} scope={scope} />
    <CourseFamilyList families={families} totalCount={totalCount} hasFilters={hasFilters} resetHref={resetHref} />
  </section>;
}
