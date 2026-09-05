import { notFound, redirect } from "next/navigation";

export default async function SupportAssessmentPreviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { locale } = await params;
  redirect(`/${locale}/dashboard/followups/assessments`);
}
