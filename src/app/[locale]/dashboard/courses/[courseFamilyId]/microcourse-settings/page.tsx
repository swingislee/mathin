import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listStaffOptions } from "@/features/school/classes";
import { TeacherMicrocourseSceneManager } from "@/features/school/teaching-operations/TeacherMicrocourseSceneManager";
import { TeacherMicrocourseDuplicateManager } from "@/features/school/teaching-operations/TeacherMicrocourseDuplicateManager";
import { listTeacherMicrocourseDuplicateReport } from "@/features/school/teaching-operations/teacher-microcourse-maintenance";
import { getTeacherMicrocourseConfiguration } from "@/features/school/teaching-operations/teacher-microcourse-scenes";
import { Link } from "@/i18n/navigation";
import { requirePerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

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

  return <div className="w-full min-w-0 space-y-6 py-2">
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="font-display text-2xl">{t("settingsTitle")}</CardTitle>
          <CardDescription>{t("settingsDescription")}</CardDescription>
        </div>
        <Link href={`/dashboard/courses/${courseFamilyId}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("backToBrowser")}</Link>
      </CardHeader>
    </Card>
    <TeacherMicrocourseSceneManager
      key={renderKey}
      courseFamilyId={courseFamilyId}
      locale={locale}
      configuration={configuration}
      staffOptions={staffOptions}
    />
    <TeacherMicrocourseDuplicateManager courseFamilyId={courseFamilyId} report={duplicateReport} />
  </div>;
}

function SettingsSkeleton() {
  return <div className="w-full min-w-0 space-y-5" aria-busy="true">
    <div className="h-28 animate-pulse rounded-2xl border border-line bg-card" />
    <div className="h-12 w-80 animate-pulse rounded-xl bg-moon/30" />
    <div className="h-[32rem] animate-pulse rounded-2xl border border-line bg-card" />
  </div>;
}
