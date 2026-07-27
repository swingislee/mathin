import { RouteTabs, type RouteTab } from "@/features/school/navigation/RouteTabs";

export type WorkspaceTrack = RouteTab;

/**
 * 轨道切换（doc 23 §12 / §13）：课件的原生 16:9 与适配 4:3。
 *
 * 语义上它既不是子视图（ObjectTabs）也不是流程阶段（StageNavigation）：切换轨道
 * 换的是**同一份内容的另一个产物**，两条轨道各有自己的发布状态、责任人和校对流程。
 * 讲次工作区和素材替换工作区都要用同一个东西，之前一个用 ContextBar、一个在业务
 * 组件里手写了两个 `buttonVariants` 链接——同一件事两种长相。
 */
export function TrackSwitcher({
  items,
  activeValue,
  ariaLabel,
  className,
}: {
  items: readonly WorkspaceTrack[];
  activeValue: string;
  ariaLabel: string;
  className?: string;
}) {
  return <RouteTabs items={items} activeValue={activeValue} ariaLabel={ariaLabel} className={className} />;
}
