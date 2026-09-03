import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage } from "@/features/school/dashboard-page";
import { listRecentMofaxiaoStudentImportBatches } from "@/features/school/student-imports";
import { StudentImportSourceTabs } from "@/features/school/StudentImportSourceTabs";
import { requirePerm } from "@/lib/auth";

export default async function ImportStudentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("school.students");

  return (
    <DashboardPage
      title={t("importTitle")}
      description={t("importIntro")}
      backHref="/dashboard/students"
      backLabel={t("back")}
      breadcrumbs={[{ label: t("title"), href: "/dashboard/students" }, { label: t("importTitle") }]}
    >
      <Suspense fallback={<ImportWorkspaceSkeleton />}>
        <ImportWorkspace locale={locale} />
      </Suspense>
    </DashboardPage>
  );
}

async function ImportWorkspace({ locale }: { locale: string }) {
  await requirePerm(locale, "student.import");
  const mofaxiaoBatches = await listRecentMofaxiaoStudentImportBatches();
  return <StudentImportSourceTabs mofaxiaoBatches={mofaxiaoBatches} />;
}

function ImportWorkspaceSkeleton() {
  return (
    <div aria-hidden className="space-y-8">
      <div className="h-40 animate-pulse rounded-xl bg-line/20" />
      <div className="h-64 animate-pulse rounded-xl bg-line/20" />
    </div>
  );
}
