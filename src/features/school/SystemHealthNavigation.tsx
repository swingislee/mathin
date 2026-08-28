import { getTranslations } from "next-intl/server";
import {
  DashboardCommandPanel,
  DashboardCommandState,
} from "./dashboard-page/DashboardCommandPanel";
import { DashboardCommandTabs } from "./dashboard-page/DashboardCommandTabs";

export async function SystemHealthNavigation({
  active,
  canViewRuntime = true,
}: {
  active: "runtime" | "capabilities";
  canViewRuntime?: boolean;
}) {
  const t = await getTranslations("school.capabilityRelease");
  const items = [
    ...(canViewRuntime ? [{ value: "runtime", label: t("runtimeTab"), href: "/dashboard/system-health" }] : []),
    { value: "capabilities", label: t("capabilitiesTab"), href: "/dashboard/system-health/capabilities" },
  ];
  return (
    <DashboardCommandPanel>
      <DashboardCommandState>
        <DashboardCommandTabs
          activeValue={active}
          ariaLabel={t("navigationLabel")}
          items={items}
        />
      </DashboardCommandState>
    </DashboardCommandPanel>
  );
}
