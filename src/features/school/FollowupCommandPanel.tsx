import type { ReactNode } from "react";
import { DashboardCommandPanel } from "./dashboard-page/DashboardCommandPanel";

/** 五表按导航、工作队列、条件、操作的 DOM 顺序排布，空间不足时按完整控件换行。 */
export function FollowupCommandPanel({ children }: { children: ReactNode }) {
  return <DashboardCommandPanel className="followup-command-panel min-h-0 gap-x-3 gap-y-1.5 py-1.5 @3xl/chrome:flex [&>[data-dashboard-command-slot=state]]:shrink-0 [&>[data-dashboard-command-slot=filters]]:contents [&>[data-dashboard-command-slot=actions]]:gap-1.5 [&>[data-dashboard-command-slot=actions]:empty]:hidden">
    {children}
  </DashboardCommandPanel>;
}
