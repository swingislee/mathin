import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage } from "@/features/school/dashboard-page";
import { listStaffOptions } from "@/features/school/classes";
import { TeacherMicrocourseSceneManager } from "@/features/school/teaching-operations/TeacherMicrocourseSceneManager";
import { TeacherMicrocourseDuplicateManager } from "@/features/school/teaching-operations/TeacherMicrocourseDuplicateManager";
import { listTeacherMicrocourseDuplicateReport } from "@/features/school/teaching-operations/teacher-microcourse-maintenance";
import { getTeacherMicrocourseConfiguration } from "@/features/school/teaching-operations/teacher-microcourse-scenes";
import { requirePerm } from "@/lib/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function TeacherMicrocourseSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; courseFamilyId: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Suspense fallback={<SettingsSkeleton />}>
    <TeacherMicrocourseSettingsContent params={params} />
  </Suspense>;
}

async function TeacherMicrocourseSettingsContent({
  params,
}: {
  params: Promise<{ locale: string; courseFamilyId: string }>;
}) {
  const { locale, courseFamilyId } = await params;
  if (!UUID.test(courseFamilyId)) notFound();
  await requirePerm(locale, "course.view");
  const t = await getTranslations("school.teacherMicrocourseBrowser");
  let configuration;
  let duplicateReport;
  try {
    [configuration, duplicateReport] = await Promise.all([
      getTeacherMicrocourseConfiguration(courseFamilyId),
      listTeacherMicrocourseDuplicateReport(courseFamilyId),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("COURSE_FAMILY_NOT_FOUND")) notFound();
    throw error;
  }
  const staffOptions = await listStaffOptions();
  const renderKey = configuration.roots.map((root) => `${root.id}:${root.sortOrder}:${root.enabled}:${root.scenes.length}`).join("|")
    + configuration.gradeStages.map((item) => `${item.id}:${item.sortOrder}:${item.active}`).join("|");

  return <DashboardPage
    title={t("settingsTitle")}
    description={t("settingsDescription")}
    backHref={`/dashboard/courses/${courseFamilyId}`}
    backLabel={t("backToBrowser")}
    density="compact"
  >
    <TeacherMicrocourseSceneManager
      key={renderKey}
      courseFamilyId={courseFamilyId}
      locale={locale}
      configuration={configuration}
      staffOptions={staffOptions}
    />
    <TeacherMicrocourseDuplicateManager courseFamilyId={courseFamilyId} report={duplicateReport} />
  </DashboardPage>;
}

function SettingsSkeleton() {
  return <div className="w-full min-w-0 space-y-5" aria-busy="true">
    <div className="h-20 animate-pulse bg-moon/20" />
    <div className="h-10 w-80 animate-pulse bg-moon/30" />
    <div className="h-[32rem] animate-pulse bg-moon/20" />
  </div>;
}
