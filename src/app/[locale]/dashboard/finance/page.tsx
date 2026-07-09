import { setRequestLocale } from "next-intl/server";
import { SchoolPlaceholderPage } from "@/features/school/PlaceholderPage";
import { requireAnyPerm } from "@/lib/auth";

export default async function FinancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPerm(locale, ["finance.order.view", "finance.report.view"]);
  return <SchoolPlaceholderPage labelKey="finance" />;
}
