import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { SchoolPageHeader } from "@/features/school/PageHeader";
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
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader title={t("title")} />
      <Suspense fallback={<div className="mt-6 h-56 animate-pulse rounded-2xl border border-line bg-card" />}><CourseFamilyLibrary locale={locale} searchParams={searchParams} /></Suspense>
    </div>
  );
}

async function CourseFamilyLibrary({ locale, searchParams }: { locale: string; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [rawSearchParams] = await Promise.all([searchParams, requirePerm(locale, "course.view")]);
  const filters = parseCourseFamilyFilters(rawSearchParams);
  const { families, totalCount } = await listCourseFamilies(filters);
  const hasFilters = Boolean(filters.q || filters.grade || filters.courseSeason || filters.classType || filters.familyStatus || filters.variantStatus || filters.purpose || filters.readiness);
  return <section className="mt-6">
    <CourseFamilyFilters filters={filters} />
    <CourseFamilyList families={families} totalCount={totalCount} hasFilters={hasFilters} resetHref="/dashboard/courses" />
  </section>;
}
