import { getTranslations, setRequestLocale } from "next-intl/server";
import { ImportStudentsPanel } from "@/features/school/ImportStudentsPanel";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { requirePerm } from "@/lib/auth";

export default async function ImportStudentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "student.import");
  const t = await getTranslations("school.students");

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader
        title={t("importTitle")}
        backHref="/dashboard/students"
        backLabel={t("back")}
        breadcrumbs={[{ label: t("title"), href: "/dashboard/students" }, { label: t("importTitle") }]}
      >
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("importIntro")}</p>
      </SchoolPageHeader>
      <ImportStudentsPanel />
    </div>
  );
}
