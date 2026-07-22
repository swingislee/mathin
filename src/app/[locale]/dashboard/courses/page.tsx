import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { getTemplateProgress } from "@/features/school/dashboard";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { StatusStrip, type StatusStripItem } from "@/features/school/stage/StatusStrip";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { CourseFamilyFilters } from "@/features/school/teaching-operations/CourseFamilyFilters";
import { CourseFamilyList } from "@/features/school/teaching-operations/CourseFamilyList";
import { listCourseFamilies, parseCourseFamilyFilters } from "@/features/school/teaching-operations/course-queries";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

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
  const [gradeT, perms] = await Promise.all([getTranslations("school.students"), getMyPerms(user.id)]);
  const canTemplateProgress = perms.has("course.manage");
  const filters = parseCourseFamilyFilters(rawSearchParams);
  const [{ families, totalCount }, templateProgress] = await Promise.all([
    listCourseFamilies(filters),
    canTemplateProgress ? safe(getTemplateProgress, []) : Promise.resolve([]),
  ]);
  const hasFilters = Boolean(filters.q || filters.grade || filters.courseSeason || filters.classType || filters.familyStatus || filters.variantStatus || filters.purpose || filters.readiness);
  const statusItems: StatusStripItem[] = templateProgress.map((row) => ({
    label: gradeT("grade", { grade: row.grade }),
    value: `${row.ready}/${row.total}`,
  }));
  return <section className="mt-6">
    {statusItems.length > 0 && <StatusStrip items={statusItems} className="mb-2" />}
    <CourseFamilyFilters filters={filters} />
    <CourseFamilyList families={families} totalCount={totalCount} hasFilters={hasFilters} resetHref="/dashboard/courses" />
  </section>;
}
