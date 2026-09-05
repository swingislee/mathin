import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage } from "@/features/school/dashboard-page";
import { LearningCheckMatrixPreview } from "@/features/school/LearningCheckMatrixPreview";
import { requireDashboardEnvironment } from "@/lib/auth";

export default async function LearningMatrixPreviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { locale } = await params;
  setRequestLocale(locale);
  await requireDashboardEnvironment(locale, ["staff"]);
  const t = await getTranslations("school.session");

  return (
    <DashboardPage
      title={t("learningMatrixPreviewTitle")}
      description={t("learningMatrixPreviewDescription", { students: 20, questions: 19 })}
      meta={t("learningMatrixPreviewLocal")}
      density="compact"
      contentClassName="min-h-0"
    >
      <LearningCheckMatrixPreview />
    </DashboardPage>
  );
}
