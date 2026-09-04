import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { SupportAssessmentPreview } from "@/features/school/SupportAssessmentPreview";
import { requireDashboardEnvironment } from "@/lib/auth";

export default async function SupportAssessmentPreviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { locale } = await params;
  setRequestLocale(locale);
  await requireDashboardEnvironment(locale, ["staff"]);

  return <SupportAssessmentPreview locale={locale} />;
}
