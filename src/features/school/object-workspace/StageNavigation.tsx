import { RouteTabs, type RouteTab } from "@/features/school/navigation/RouteTabs";

export type WorkspaceStage = RouteTab;

/**
 * 工作阶段导航（doc 23 §10）：课前 / 课堂 / 课后。
 *
 * 与 ObjectTabs 的区别是语义：ObjectTabs 是同一对象的并列视图，随便怎么切；
 * StageNavigation 表达的是一条**有先后的流程**——课前没做完就进课堂，是流程问题
 * 而不是视图偏好。URL 参数也因此从 `?tab=` 改成 `?stage=`：`tab` 说的是
 * "我想看哪一块"，`stage` 说的是"这节课走到哪一步了"。
 *
 * 视觉沿用同一套分段控件，用户不需要学两种切换手势。
 */
export function StageNavigation({
  items,
  activeValue,
  ariaLabel,
  className,
}: {
  items: readonly WorkspaceStage[];
  activeValue: string;
  ariaLabel: string;
  className?: string;
}) {
  return <RouteTabs items={items} activeValue={activeValue} ariaLabel={ariaLabel} className={className} />;
}
