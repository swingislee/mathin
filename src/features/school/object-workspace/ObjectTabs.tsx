import { RouteTabs, type RouteTab } from "@/features/school/navigation/RouteTabs";

export type ObjectTab = RouteTab;

/**
 * 对象工作区的子视图切换（doc 23 §4.3B）：班级的课次/学生/教学准备/运营记录、
 * 学生的档案/跟进/学习……
 *
 * 与 DashboardCommandTabs 同实现（navigation/RouteTabs），区别只在语义命名。
 * 它取代的是 ContextBar 的 tabs 分支——那个组件把"子视图切换"和"筛选器"混在一条里，
 * 于是每个页面都得先想清楚自己那条到底是导航还是工具栏。这里只回答"我在这个对象的
 * 哪个视图"，筛选属于各视图自己的正文。
 */
export function ObjectTabs({
  items,
  activeValue,
  ariaLabel,
  className,
}: {
  items: readonly ObjectTab[];
  activeValue: string;
  ariaLabel: string;
  className?: string;
}) {
  return <RouteTabs items={items} activeValue={activeValue} ariaLabel={ariaLabel} className={className} />;
}
