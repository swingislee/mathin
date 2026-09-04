"use client";

import { useEffect } from "react";
import {
  DashboardCommandTabs,
  type DashboardCommandTab,
} from "@/features/school/dashboard-page";
import {
  STAFF_HOME_VIEW_COOKIE,
  staffHomeHref,
  type StaffHomeView,
} from "./staff-home-contract";

export function StaffHomeViewTabs({
  activeView,
  period,
  workItemCount,
  ariaLabel,
  workLabel,
  overviewLabel,
}: {
  activeView: StaffHomeView;
  period: "week" | "month";
  workItemCount: number;
  ariaLabel: string;
  workLabel: string;
  overviewLabel: string;
}) {
  useEffect(() => {
    document.cookie = `${STAFF_HOME_VIEW_COOKIE}=${activeView}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [activeView]);

  const items: DashboardCommandTab[] = [
    {
      value: "work",
      label: workLabel,
      href: staffHomeHref("work"),
      badge: workItemCount > 0 ? (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-rose/15 px-1.5 text-[11px] text-rose">
          {workItemCount}
        </span>
      ) : undefined,
    },
    {
      value: "overview",
      label: overviewLabel,
      href: staffHomeHref("overview", period),
    },
  ];

  return (
    <DashboardCommandTabs
      items={items}
      activeValue={activeView}
      ariaLabel={ariaLabel}
      activeTone="accent"
    />
  );
}
