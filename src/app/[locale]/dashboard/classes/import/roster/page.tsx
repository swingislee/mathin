import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MofaxiaoClassRosterImportPanel } from "@/features/school/MofaxiaoClassRosterImportPanel";
import {
  listClassRosterSavedMappings,
  listClassRosterStudentOptions,
  listClassRosterTargetOptions,
  listRecentMofaxiaoClassRosterImportBatches,
} from "@/features/school/class-roster-imports";
import { DashboardPage } from "@/features/school/dashboard-page";
import { getMyPerms, requirePerm } from "@/lib/auth";

export default async function ImportClassRosterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, tClasses] = await Promise.all([
    getTranslations("school.classRosterImport"),
    getTranslations("school.classes"),
  ]);
  return (
    <DashboardPage
      title={t("title")}
      description={t("intro")}
      backHref="/dashboard/classes"
      backLabel={t("back")}
      breadcrumbs={[{ label: tClasses("title"), href: "/dashboard/classes" }, { label: t("title") }]}
    >
      <Suspense fallback={<div aria-hidden className="h-96 animate-pulse rounded-xl bg-line/20" />}>
        <ImportRosterWorkspace locale={locale} />
      </Suspense>
    </DashboardPage>
  );
}

async function ImportRosterWorkspace({ locale }: { locale: string }) {
  const user = await requirePerm(locale, "enrollment.manage");
  const [recentBatches, targetClasses, students, savedMappings, perms] = await Promise.all([
    listRecentMofaxiaoClassRosterImportBatches(),
    listClassRosterTargetOptions(),
    listClassRosterStudentOptions(),
    listClassRosterSavedMappings(),
    getMyPerms(user.id),
  ]);
  return (
    <MofaxiaoClassRosterImportPanel
      recentBatches={recentBatches}
      targetClasses={targetClasses}
      students={students}
      savedMappings={savedMappings}
      canCreateStudents={perms.has("student.import")}
      canCreateClasses={perms.has("class.create")}
    />
  );
}
