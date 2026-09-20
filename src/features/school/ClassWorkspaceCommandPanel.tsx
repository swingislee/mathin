import type { ReactNode } from "react";
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardCommandState } from "./dashboard-page";

/** 班级各视图共用：视图与分组、时间范围、辅助操作。 */
export function ClassWorkspaceCommandPanel({ navigation, grouping, period, actions }: {
  navigation?: ReactNode; grouping?: ReactNode; period?: ReactNode; actions?: ReactNode;
}) {
  return <DashboardCommandPanel className="followup-command-panel">
    <DashboardCommandState>{navigation}{grouping}</DashboardCommandState>
    {period ? <DashboardCommandFilters>{period}</DashboardCommandFilters> : null}
    {actions ? <DashboardCommandActions>{actions}</DashboardCommandActions> : null}
  </DashboardCommandPanel>;
}
