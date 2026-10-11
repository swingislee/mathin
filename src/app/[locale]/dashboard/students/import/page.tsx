import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DataInboxPanel } from "@/features/school/DataInboxPanel";
import { DashboardPage } from "@/features/school/dashboard-page";
import { listRecentLeadImportBatches } from "@/features/school/lead-imports";
import { listRecentMofaxiaoStudentImportBatches, listRecentStudentImportBatches } from "@/features/school/student-imports";
import { requirePerm } from "@/lib/auth";

export default async function ImportStudentsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const [t, leadT] = await Promise.all([getTranslations("school.students"), getTranslations("school.leads")]);
  const fromLeads = query.from === "leads";
  const backHref = fromLeads ? "/dashboard/leads" : "/dashboard/students";

  return (
    <DashboardPage
      title={t("importTitle")}
      description={t("importIntro")}
      backHref={backHref}
      backLabel={fromLeads ? leadT("back") : t("back")}
      breadcrumbs={[{ label: fromLeads ? leadT("title") : t("title"), href: backHref }, { label: t("importTitle") }]}
    >
      <Suspense fallback={<ImportWorkspaceSkeleton />}>
        <ImportWorkspace locale={locale} />
      </Suspense>
    </DashboardPage>
  );
}

async function ImportWorkspace({ locale }: { locale: string }) {
  await requirePerm(locale, "student.import");
  const [leadBatches, studentBatches, mofaxiaoBatches] = await Promise.all([
    listRecentLeadImportBatches(),
    listRecentStudentImportBatches(),
    listRecentMofaxiaoStudentImportBatches(),
  ]);
  return <DataInboxPanel leadBatches={leadBatches} studentBatches={studentBatches} mofaxiaoBatches={mofaxiaoBatches} />;
}

function ImportWorkspaceSkeleton() {
  return (
    <div aria-hidden className="space-y-8">
      <div className="h-40 animate-pulse rounded-xl bg-line/20" />
      <div className="h-64 animate-pulse rounded-xl bg-line/20" />
    </div>
  );
}
