import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 对象上下文切换器（doc 23 §7.2 / §8.2）。
 *
 * 与 ObjectTabs 的区别是**语义**而不是外观：ObjectTabs 回答"这个对象的哪个视图"
 * （课次 / 学生 / 教学准备），切换的是看什么；ObjectContextSwitcher 回答"这个对象的
 * 哪个切面"（哪个年级 · 哪个班型 · 哪个课程季节），切换之后你看的仍是同一件事，
 * 只是换了一个具体对象。
 *
 * 之前课程版本选择器被塞在正文第一张卡里，于是"我正在看哪个版本"这件事既不在身份区、
 * 也不在导航区，滚动一下就看不见了——而它恰恰是这一页每个决策的前提。
 *
 * 只提供带标签的横向区域，不知道被切换的是什么：具体控件（VariantSelector 等）
 * 由业务域提供。
 */
export function ObjectContextSwitcher({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-object-context-switcher
      className={cn("flex min-w-0 items-center gap-3 overflow-x-auto", className)}
    >
      <span className="shrink-0 text-xs uppercase tracking-[0.14em] text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
    </div>
  );
}
