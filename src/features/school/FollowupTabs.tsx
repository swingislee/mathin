"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { DashboardCommandTabs } from "./dashboard-page/DashboardCommandTabs";

export const FOLLOWUP_SECTIONS = ["leads", "communication", "assessments", "enrollments", "renewals"] as const;

export function FollowupTabs() {
  const t = useTranslations("school.followupWorkspace");
  const pathname = usePathname();
  const active = FOLLOWUP_SECTIONS.find((section) => pathname.startsWith(`/dashboard/followups/${section}`)) ?? "leads";
  return <DashboardCommandTabs ariaLabel={t("title")} activeValue={active} items={FOLLOWUP_SECTIONS.map((section) => ({
    value: section, label: t(section), href: `/dashboard/followups/${section}`,
  }))} />;
}
