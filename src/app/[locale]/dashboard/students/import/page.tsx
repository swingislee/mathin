import { getTranslations, setRequestLocale } from "next-intl/server";
import { ImportStudentsPanel } from "@/features/school/ImportStudentsPanel";
import { DashboardPage } from "@/features/school/dashboard-page";
import { requirePerm } from "@/lib/auth";

export default async function ImportStudentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "student.import");
  const t = await getTranslations("school.students");

  return (
    <DashboardPage
      title={t("importTitle")}
      description={t("importIntro")}
      backHref="/dashboard/students"
      backLabel={t("back")}
      breadcrumbs={[{ label: t("title"), href: "/dashboard/students" }, { label: t("importTitle") }]}
    >
      <ImportStudentsPanel />
    </DashboardPage>
  );
}
