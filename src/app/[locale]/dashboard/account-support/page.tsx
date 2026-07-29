import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AccountSupportPanel } from "@/features/account/AccountSupportPanel";
import { getAccountSupportSnapshot } from "@/features/account/account-security";
import { DashboardPage } from "@/features/school/dashboard-page";
import { DashboardListSkeleton } from "@/features/school/list-skeleton";
import { requirePerm } from "@/lib/auth";

async function AccountSupportBody({ locale }: { locale: string }) {
  await requirePerm(locale, "account.support.manage");
  return <AccountSupportPanel snapshot={await getAccountSupportSnapshot()} />;
}

export default async function AccountSupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("account.support");
  return <DashboardPage title={t("title")} description={t("intro")}>
    <Suspense fallback={<DashboardListSkeleton />}><AccountSupportBody locale={locale} /></Suspense>
  </DashboardPage>;
}
