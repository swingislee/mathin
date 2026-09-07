import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage } from "@/features/school/dashboard-page";
import { MonthlyTargetsEditor } from "@/features/school/home/MonthlyTargetsEditor";
import { readMonthlyTargets } from "@/features/school/home/monthly-targets-data";
import { requirePerm } from "@/lib/auth";

export default async function MonthlyTargetsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requirePerm(locale, "organization.settings.manage");
  const month = typeof search.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.month) ? search.month : "2026-09";
  const [t, result] = await Promise.all([getTranslations("school.monthlyTargets"), readMonthlyTargets(month)]);
  if (result.plan) return <MonthlyTargetsEditor key={`${month}:${result.plan.revision}`} plan={result.plan} />;
  return <DashboardPage title={t("title", { month })} backHref={`/dashboard?view=overview&period=month&date=${month}-01`} backLabel={t("back")}>
    <p role={result.available ? undefined : "alert"} className="text-sm text-muted">{t(result.available ? "notCreated" : "unavailable")}</p>
  </DashboardPage>;
}
