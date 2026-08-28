import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage } from "@/features/school/dashboard-page";
import { getScheduleDefaultsV2 } from "@/features/school/organization-locations";
import { ScheduleDefaultsForm } from "@/features/school/ScheduleDefaultsForm";
import { requirePerm } from "@/lib/auth";

export default async function ScheduleDefaultsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-2xl border border-line bg-card" />}>
      <ScheduleDefaultsBody locale={locale} />
    </Suspense>
  );
}

async function ScheduleDefaultsBody({ locale }: { locale: string }) {
  await requirePerm(locale, "schedule.manage");
  const [t, defaults] = await Promise.all([
    getTranslations("school.scheduleDefaults"),
    getScheduleDefaultsV2(),
  ]);
  return <DashboardPage title={t("title")} description={t("intro")}><ScheduleDefaultsForm defaults={defaults} /></DashboardPage>;
}
