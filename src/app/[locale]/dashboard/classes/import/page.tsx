import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MofaxiaoClassImportPanel } from "@/features/school/MofaxiaoClassImportPanel";
import { listClassImportCourseOptions, listRecentMofaxiaoClassImportBatches } from "@/features/school/class-imports";
import { listStaffOptions } from "@/features/school/classes";
import { listSchoolTerms } from "@/features/school/courses";
import { DashboardPage } from "@/features/school/dashboard-page";
import { listActiveRoomOptionsV2 } from "@/features/school/organization-locations";
import { requirePerm } from "@/lib/auth";

export default async function ImportClassesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, tClasses] = await Promise.all([
    getTranslations("school.classImport"),
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
      <Suspense fallback={<div aria-hidden className="h-80 animate-pulse rounded-xl bg-line/20" />}>
        <ImportClassWorkspace locale={locale} />
      </Suspense>
    </DashboardPage>
  );
}

async function ImportClassWorkspace({ locale }: { locale: string }) {
  await requirePerm(locale, "class.create");
  const [recentBatches, courseOptions, teachers, roomOptions, schoolTerms] = await Promise.all([
    listRecentMofaxiaoClassImportBatches(),
    listClassImportCourseOptions(),
    listStaffOptions(),
    listActiveRoomOptionsV2(),
    listSchoolTerms(),
  ]);
  return (
    <MofaxiaoClassImportPanel
      recentBatches={recentBatches}
      courseOptions={courseOptions}
      teachers={teachers}
      roomOptions={roomOptions}
      schoolTerms={schoolTerms}
    />
  );
}
