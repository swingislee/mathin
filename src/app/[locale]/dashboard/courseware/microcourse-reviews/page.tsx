import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MicrocourseReviewWorkspace } from "@/features/teacher-microcourses/MicrocourseReviewWorkspace";
import { DashboardPage } from "@/features/school/dashboard-page";
import { requirePerm } from "@/lib/auth";

export default async function MicrocourseReviewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "courseware.review");
  const t = await getTranslations("teacherMicrocourses");

  return (
    <DashboardPage title={t("reviewWorkspaceTitle")}>
      <Suspense fallback={<div className="h-96 animate-pulse bg-moon/10" />}>
        <MicrocourseReviewWorkspace locale={locale} />
      </Suspense>
    </DashboardPage>
  );
}
