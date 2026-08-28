import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CapabilityReleasePanel } from "@/features/school/CapabilityReleasePanel";
import { listCapabilityReleaseV2 } from "@/features/school/capability-release";
import { DashboardPage } from "@/features/school/dashboard-page";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { SystemHealthNavigation } from "@/features/school/SystemHealthNavigation";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";

const CAPABILITY_ACCESS = ["audit.view", "system.operations.manage"] as const;

export default async function CapabilityReleasePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl border border-line bg-card" />}>
      <CapabilityReleaseBody locale={locale} />
    </Suspense>
  );
}

async function CapabilityReleaseBody({ locale }: { locale: string }) {
  const user = await requireAnyPerm(locale, CAPABILITY_ACCESS);
  const [t, capabilities, timeZone, perms] = await Promise.all([
    getTranslations("school.capabilityRelease"),
    listCapabilityReleaseV2(),
    getOrganizationTimezoneV2(),
    getMyPerms(user.id),
  ]);
  return (
    <DashboardPage
      title={t("title")}
      description={t("intro")}
      meta={<span>{timeZone}</span>}
      commandPanel={<SystemHealthNavigation active="capabilities" canViewRuntime={perms.has("audit.view")} />}
    >
      <CapabilityReleasePanel capabilities={capabilities} canManage={perms.has("system.operations.manage")} timeZone={timeZone} />
    </DashboardPage>
  );
}
