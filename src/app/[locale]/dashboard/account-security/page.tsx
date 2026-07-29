import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AccountSecurityPanel } from "@/features/account/AccountSecurityPanel";
import { getAccountSecuritySnapshot } from "@/features/account/account-security";
import { DashboardPage } from "@/features/school/dashboard-page";
import { DashboardListSkeleton } from "@/features/school/list-skeleton";
import { getProfile, requireUser } from "@/lib/auth";

async function AccountSecurityBody({ locale }: { locale: string }) {
  const user = await requireUser(locale, { allowAccountRecovery: true });
  const [profile, snapshot] = await Promise.all([getProfile(user.id), getAccountSecuritySnapshot()]);
  return <AccountSecurityPanel snapshot={snapshot} isAdmin={profile?.role === "admin"} />;
}

export default async function AccountSecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("account.security");
  return <DashboardPage title={t("title")} description={t("intro")}>
    <Suspense fallback={<DashboardListSkeleton />}><AccountSecurityBody locale={locale} /></Suspense>
  </DashboardPage>;
}
