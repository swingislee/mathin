import type { ReactNode } from "react";
import { DashboardCommandPanel } from "./dashboard-page/DashboardCommandPanel";

/** 学辅五表共用标题栏；笔记本上筛选独占整行，宽工作区合并为一行。 */
export function FollowupCommandPanel({ children }: { children: ReactNode }) {
  return <DashboardCommandPanel className="@3xl/chrome:flex [&>[data-dashboard-command-slot=state]]:order-1 [&>[data-dashboard-command-slot=actions]]:order-2 [&>[data-dashboard-command-slot=filters]]:order-3 [&>[data-dashboard-command-slot=filters]]:basis-full @7xl/chrome:[&>[data-dashboard-command-slot=filters]]:order-1 @7xl/chrome:[&>[data-dashboard-command-slot=filters]]:basis-auto @7xl/chrome:[&>[data-dashboard-command-slot=filters]]:flex-1">
    {children}
  </DashboardCommandPanel>;
}
