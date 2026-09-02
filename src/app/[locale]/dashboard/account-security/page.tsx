import { CircleAlert } from "lucide-react";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AccountSecurityPanel } from "@/features/account/AccountSecurityPanel";
import { getAccountCenterSnapshot } from "@/features/account/account-security";
import { DashboardPage } from "@/features/school/dashboard-page";
import { DashboardListSkeleton } from "@/features/school/list-skeleton";
import { getProfile, requireUser } from "@/lib/auth";

type AccountRequirement = "password" | "mfa" | "consent" | null;

async function AccountSecurityBody({ locale, required }: { locale: string; required: AccountRequirement }) {
  const user = await requireUser(locale, { allowAccountRecovery: true });
  const profile = await getProfile(user.id);
  if (!profile) throw new Error("PROFILE_NOT_FOUND");
  const snapshot = await getAccountCenterSnapshot(user, profile);
  return <AccountSecurityPanel
    snapshot={snapshot}
    initialSection={required === "mfa" || profile.passwordChangeRequired ? "security" : required === "consent" ? "privacy" : "profile"}
    forcePasswordChange={profile.passwordChangeRequired}
  />;
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
  const required = rawRequired === "password" || rawRequired === "mfa" || rawRequired === "consent"
    ? rawRequired
    : null;
  const requiredTitle = required === "password"
    ? "requiredPasswordTitle"
    : required === "mfa"
      ? "requiredMfaTitle"
      : "requiredConsentTitle";
  const requiredBody = required === "password"
    ? "requiredPasswordBody"
    : required === "mfa"
      ? "requiredMfaBody"
      : "requiredConsentBody";

  return <DashboardPage title={t("title")} description={t("intro")}>
    {required && (
      <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-400/60 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
        <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">{t(requiredTitle)}</p>
          <p className="mt-1 text-sm opacity-85">{t(requiredBody)}</p>
          {required !== "password" ? (
            <a href={required === "mfa" ? "#mfa" : "#consent"} className="mt-2 inline-block text-sm font-medium underline underline-offset-2">{t("fixNow")}</a>
          ) : null}
        </div>
      </div>
    )}
    <Suspense fallback={<DashboardListSkeleton />}><AccountSecurityBody locale={locale} required={required} /></Suspense>
  </DashboardPage>;
}
