import { RouteTabs, type RouteTab } from "@/features/school/navigation/RouteTabs";

export type DashboardCommandTab = RouteTab;

/**
 * 命令面板里的多状态互斥切换（docs/plan/21 §15.2）：当前 / 回收站、我的 / 全部、
 * 待处理 / 已完成。
 *
 * doc 23 §4.3B 之后这里只剩一层命名：实现在 navigation/RouteTabs，与对象工作区的
 * ObjectTabs 共用同一份 DOM、窄屏行为与 active 语义。保留这个名字，是因为调用点
 * 应该读起来是"命令面板的状态切换"，而不是泛泛的"一组路由标签"。
 */
export function DashboardCommandTabs({
  items,
  activeValue,
  ariaLabel,
  activeTone,
  className,
}: {
  items: readonly DashboardCommandTab[];
  activeValue: string;
  ariaLabel: string;
  activeTone?: "surface" | "accent";
  className?: string;
}) {
  return (
    <RouteTabs
      items={items}
      activeValue={activeValue}
      ariaLabel={ariaLabel}
      activeTone={activeTone}
      className={className}
    />
  );
}
