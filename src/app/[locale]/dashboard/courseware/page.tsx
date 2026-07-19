import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CoursewareTaskQueue } from "@/features/courseware-studio/CoursewareTaskQueue";
import {
  COURSEWARE_STUDIO_PERMS,
  parseCoursewareTaskQuery,
  parseCoursewareTaskTab,
} from "@/features/courseware-studio/data";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { requireAnyPerm } from "@/lib/auth";

export default async function CoursewareTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("coursewareStudio");

  return <div className="mx-auto w-full max-w-6xl">
    <SchoolPageHeader title={t("workbenchTitle")}>
      <p className="mt-1 max-w-3xl text-sm text-muted">{t("workbenchIntro")}</p>
    </SchoolPageHeader>
    <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-2xl border border-line bg-card" />}>
      <CoursewareTasksContent locale={locale} searchParams={searchParams} />
    </Suspense>
  </div>;
}

async function CoursewareTasksContent({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  await requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS);
  return <CoursewareTaskQueue
    locale={locale}
    tab={parseCoursewareTaskTab(query.tab)}
    query={parseCoursewareTaskQuery(query.q)}
  />;
}
