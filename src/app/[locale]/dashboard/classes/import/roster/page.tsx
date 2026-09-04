import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MofaxiaoClassRosterImportPanel } from "@/features/school/MofaxiaoClassRosterImportPanel";
import {
  loadMofaxiaoClassRosterImportBatch,
  listClassRosterSavedMappings,
  listClassRosterStudentOptions,
  listClassRosterTargetOptions,
  listRecentMofaxiaoClassRosterImportBatches,
} from "@/features/school/class-roster-imports";
import { DashboardPage } from "@/features/school/dashboard-page";
import { getMyPerms, requirePerm } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ImportClassRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ batch?: string | string[] }>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  const batchParam = Array.isArray(rawSearchParams.batch) ? rawSearchParams.batch[0] : rawSearchParams.batch;
  const initialBatchId = batchParam && UUID_PATTERN.test(batchParam) ? batchParam : null;
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
        <ImportRosterWorkspace locale={locale} initialBatchId={initialBatchId} />
      </Suspense>
    </DashboardPage>
  );
}

async function ImportRosterWorkspace({ locale, initialBatchId }: { locale: string; initialBatchId: string | null }) {
  const user = await requirePerm(locale, "enrollment.manage");
  const [recentBatches, targetClasses, students, savedMappings, perms, initialBatch] = await Promise.all([
    listRecentMofaxiaoClassRosterImportBatches(),
    listClassRosterTargetOptions(),
    listClassRosterStudentOptions(),
    listClassRosterSavedMappings(),
    getMyPerms(user.id),
    initialBatchId ? loadMofaxiaoClassRosterImportBatch(initialBatchId) : Promise.resolve(null),
  ]);
  return (
    <MofaxiaoClassRosterImportPanel
      key={initialBatchId ?? "new"}
      initialBatch={initialBatch}
      recentBatches={recentBatches}
      targetClasses={targetClasses}
      students={students}
      savedMappings={savedMappings}
      canCreateStudents={perms.has("student.import")}
      canCreateClasses={perms.has("class.create")}
    />
  );
}
