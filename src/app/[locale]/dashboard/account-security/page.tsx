import { CircleAlert } from "lucide-react";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AccountSecurityPanel } from "@/features/account/AccountSecurityPanel";
import { getAccountCenterSnapshot } from "@/features/account/account-security";
import { DesktopNotificationControls } from "@/features/events/DesktopNotificationControls";
import { DashboardPage } from "@/features/school/dashboard-page";
import { DashboardListSkeleton } from "@/features/school/list-skeleton";
import { getProfile, requireUser } from "@/lib/auth";

async function AccountSecurityBody({ locale, required }: { locale: string; required: "mfa" | "consent" | null }) {
  const user = await requireUser(locale, { allowAccountRecovery: true });
  const profile = await getProfile(user.id);
  if (!profile) throw new Error("PROFILE_NOT_FOUND");
  const snapshot = await getAccountCenterSnapshot(user, profile);
  return <div className="grid gap-6">
    <AccountSecurityPanel
      snapshot={snapshot}
      initialSection={required === "mfa" ? "security" : required === "consent" ? "privacy" : "profile"}
    />
    {profile.role === "staff" || profile.role === "admin" ? <DesktopNotificationControls variant="full" /> : null}
  </div>;
}

export default async function AccountSecurityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations("account.security");
  const rawRequired = Array.isArray(query.required) ? query.required[0] : query.required;
  const required = rawRequired === "mfa" || rawRequired === "consent" ? rawRequired : null;

  return <DashboardPage title={t("title")} description={t("intro")}>
    {required && (
      <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-400/60 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
        <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">{t(required === "mfa" ? "requiredMfaTitle" : "requiredConsentTitle")}</p>
          <p className="mt-1 text-sm opacity-85">{t(required === "mfa" ? "requiredMfaBody" : "requiredConsentBody")}</p>
          <a href={required === "mfa" ? "#mfa" : "#consent"} className="mt-2 inline-block text-sm font-medium underline underline-offset-2">{t("fixNow")}</a>
        </div>
      </div>
    )}
    <Suspense fallback={<DashboardListSkeleton />}><AccountSecurityBody locale={locale} required={required} /></Suspense>
  </DashboardPage>;
}
