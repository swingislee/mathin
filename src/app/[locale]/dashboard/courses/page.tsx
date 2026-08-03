import { Suspense } from "react";
import { Plus } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { CourseFamilyFilters } from "@/features/school/teaching-operations/CourseFamilyFilters";
import { CourseFamilyList } from "@/features/school/teaching-operations/CourseFamilyList";
import { listCourseCatalogVersionOptions, listCourseFamilies, parseCourseFamilyFilters } from "@/features/school/teaching-operations/course-queries";

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
  const [rawSearchParams, user] = await Promise.all([searchParams, requirePerm(locale, "course.view")]);
  const [t, perms, versionOptions] = await Promise.all([
    getTranslations("school.courseProduct"),
    getMyPerms(user.id),
    listCourseCatalogVersionOptions(),
  ]);
  return (
    <DashboardCommandPanel>
      <DashboardCommandFilters>
        <CourseFamilyFilters filters={parseCourseFamilyFilters(rawSearchParams)} versionOptions={versionOptions} />
      </DashboardCommandFilters>
      {/* doc22 §13.5：只有 course.product.create 才看得到新建入口。 */}
      {perms.has("course.product.create") && (
        <DashboardCommandActions>
          <Link href="/dashboard/courses/new" className={buttonVariants({ size: "sm" })}>
            <Plus className="size-4" />
            {t("newProduct")}
          </Link>
        </DashboardCommandActions>
      )}
    </DashboardCommandPanel>
  );
}

async function CourseFamilyLibrary({ locale, searchParams }: { locale: string; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [rawSearchParams] = await Promise.all([searchParams, requirePerm(locale, "course.view")]);
  const filters = parseCourseFamilyFilters(rawSearchParams);
  const { families, totalCount } = await listCourseFamilies(filters);
  const hasFilters = Boolean(filters.q || filters.grade || filters.courseSeason || filters.classType || filters.catalogVersion || filters.familyStatus || filters.variantStatus || filters.purpose || filters.readiness);
  return <CourseFamilyList families={families} totalCount={totalCount} hasFilters={hasFilters} resetHref="/dashboard/courses" />;
}
