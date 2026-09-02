import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MicrocourseReviewPanel } from "@/features/teacher-microcourses/MicrocourseReviewPanel";
import { getTeacherMicrocourseReview } from "@/features/teacher-microcourses/data";
import { DashboardPage } from "@/features/school/dashboard-page";
import { requirePerm } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MicrocourseReviewDetailPage({
  params,
}: {
  params: Promise<{ locale: string; reviewCycleId: string }>;
}) {
  const { locale, reviewCycleId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("teacherMicrocourses");
  return (
    <DashboardPage
      title={t("reviewDetailTitle")}
      backHref="/dashboard/courseware/microcourse-reviews"
      backLabel={t("backToReviewQueue")}
    >
      <Suspense fallback={<div className="h-[42rem] animate-pulse bg-moon/10" />}>
        <MicrocourseReviewContent locale={locale} reviewCycleId={reviewCycleId} />
      </Suspense>
    </DashboardPage>
  );
}

async function MicrocourseReviewContent({ locale, reviewCycleId }: { locale: string; reviewCycleId: string }) {
  if (!UUID_PATTERN.test(reviewCycleId)) notFound();
  await requirePerm(locale, "courseware.review");
  const review = await getTeacherMicrocourseReview(reviewCycleId).catch(() => null);
  if (!review) notFound();
  return <MicrocourseReviewPanel review={review} />;
}
