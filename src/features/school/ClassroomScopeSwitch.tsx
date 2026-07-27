import { getTranslations } from "next-intl/server";
import { DashboardCommandTabs } from "./dashboard-page";
import type { ClassroomScope } from "./teaching-operations/types";

/** 班级列表的 scope 切换：我的授课 / 我负责 / 全部 / 测试。命令面板的状态区。 */
export async function ClassroomScopeSwitch({ activeScope, availableScopes }: { activeScope: ClassroomScope; availableScopes: readonly ClassroomScope[] }) {
  const t = await getTranslations("school.classes");
  return (
    <DashboardCommandTabs
      ariaLabel={t("scopeLabel")}
      activeValue={activeScope}
      items={availableScopes.map((scope) => ({
        value: scope,
        label: t(`scope_${scope}`),
        href: `/dashboard/classes?scope=${scope}`,
      }))}
    />
  );
}
