import { setRequestLocale } from "next-intl/server";
import { ManagementAnalyticsDashboard } from "@/features/school/ManagementAnalyticsDashboard";
import {
  normalizeManagementAnalyticsGrain,
  resolveManagementAnalyticsSourceAccess,
} from "@/features/school/management-analytics-contract";
import { getMyPerms, requirePerm } from "@/lib/auth";

export default async function ManagementAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requirePerm(locale, "report.view.all");
  const permissions = await getMyPerms(user.id);
  const sourceAccess = resolveManagementAnalyticsSourceAccess(permissions);
  const grain = normalizeManagementAnalyticsGrain(
    typeof rawSearchParams.period === "string" ? rawSearchParams.period : undefined,
  );
  return <ManagementAnalyticsDashboard locale={locale} grain={grain} sourceAccess={sourceAccess} />;
}
