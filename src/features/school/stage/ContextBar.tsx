"use client";

import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface ContextBarTab {
  value: string;
  label: string;
  href: string;
}

/**
 * 对象工作区第二条（docs/plan/19-p4i-final.md §17）。与 ObjectBar 分离，
 * 只承载"当前视图切换"（子视图 tab）和筛选,不重复对象身份信息。
 * tab 通过真实 href 跳转（响应式驱动而非本地 state）,对齐现有列表页
 * `?tab=` 路由约定,Tabs 只提供样式与键盘导航,不吞掉导航行为。
 */
export function ContextBar({
  tabs,
  activeTab,
  filters,
  className,
}: {
  tabs?: readonly ContextBarTab[];
  activeTab?: string;
  filters?: ReactNode;
  className?: string;
}) {
  if (!tabs?.length && !filters) return null;
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-line py-3", className)}>
      {tabs && tabs.length > 0 ? (
        <Tabs value={activeTab} onValueChange={() => undefined} className="min-w-0">
          <TabsList>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} asChild>
                <Link href={tab.href}>{tab.label}</Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
      {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
    </div>
  );
}
