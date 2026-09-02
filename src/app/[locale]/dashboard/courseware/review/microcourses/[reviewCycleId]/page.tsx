import { redirect } from "next/navigation";

export default async function MicrocourseReviewDetailPage({
  params,
}: {
  params: Promise<{ locale: string; reviewCycleId: string }>;
}) {
  const { locale, reviewCycleId } = await params;
  redirect(`/${locale}/dashboard/courseware/microcourse-reviews/${reviewCycleId}`);
}
