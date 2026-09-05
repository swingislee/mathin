"use client";

import { useTranslations } from "next-intl";
import { DashboardCommandTabs } from "./dashboard-page";

export type RenewalWorkspaceTab = "pool" | "signals" | "growth" | "settings" | "health";

export function RenewalNavTabs({ active, cycleId }: { active: RenewalWorkspaceTab; cycleId?: string }) {
  const t = useTranslations("school.renewals");
  return (
    <DashboardCommandTabs
      ariaLabel={t("workspaceTabs")}
      activeValue={active}
      items={[
        { value: "pool", label: t("renewalPool"), href: `/dashboard/followups/renewals${cycleId ? `?cycle=${cycleId}` : ""}` },
        { value: "health", label: t("poolV2.health"), href: `/dashboard/followups/renewals?tab=health${cycleId ? `&cycle=${cycleId}` : ""}` },
        { value: "settings", label: t("poolV2.settings"), href: `/dashboard/followups/renewals?tab=settings${cycleId ? `&cycle=${cycleId}` : ""}` },
        { value: "growth", label: t("reactivationAndReferrals"), href: "/dashboard/followups/renewals/growth" },
      ]}
    />
  );
}
