"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * 讲次/对象覆盖层（docs/plan/19-p4i-final.md §9.3/§17.4/§17.5）。受控组件，
 * 不持有列表/筛选/分页状态——那些属于调用方页面；只要打开/关闭不触发路由
 * 跳转，背景就不会被卸载，那些状态天然保留。本组件负责两件对齐 doc19
 * "关闭后恢复"、可由组件自身保证的事：
 * 1. 记录打开前主滚动区（默认取页面唯一的 `<main>`，可用 scrollContainerRef
 *    覆盖）的 scrollTop，关闭时还原。
 * 2. 用全局 `focusin` 监听（而非在 open 变化的 effect 里读
 *    `document.activeElement`）记录打开前最后获得焦点的元素。还原焦点挂在
 *    Radix 的 `onCloseAutoFocus` 上并 `preventDefault`——这是 Radix 自己
 *    "把焦点还给触发者"的钩子，实测发现如果不 `preventDefault` 而是自己
 *    另开一个 `requestAnimationFrame` 去 `.focus()`，会和 Radix 内部的
 *    默认还原逻辑竞态，谁后跑谁赢，曾经出现焦点最终落在 `document.body`
 *    而不是原触发元素上；挂在 `onCloseAutoFocus` 就是在 Radix 决定"该把
 *    焦点还原到哪"的唯一时机上直接接管，不存在竞态。
 */
export function ObjectOverlay({
  open,
  onOpenChange,
  title,
  children,
  decisionRail,
  closeLabel,
  scrollContainerRef,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 供无障碍朗读的对象名称；覆盖层不重复可见标题，视觉标题由 children 内的 ObjectBar 承担。 */
  title: string;
  children: ReactNode;
  decisionRail?: ReactNode;
  closeLabel?: string;
  /** 打开前需要记录/还原滚动位置的容器；不传时取页面唯一的 `<main>`。 */
  scrollContainerRef?: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const scrollSnapshotRef = useRef<{ el: HTMLElement; top: number } | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      if (wasOpenRef.current) return;
      if (event.target instanceof HTMLElement) lastFocusedRef.current = event.target;
    };
    window.addEventListener("focusin", handleFocusIn);
    return () => window.removeEventListener("focusin", handleFocusIn);
  }, []);

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    if (justOpened) {
      const el = scrollContainerRef?.current ?? document.querySelector("main");
      if (el) scrollSnapshotRef.current = { el, top: el.scrollTop };
    }
    wasOpenRef.current = open;
  }, [open, scrollContainerRef]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        closeLabel={closeLabel}
        className={cn(
          "flex w-screen max-w-none flex-col gap-0 p-0 lg:h-[min(93vh,836px)] lg:w-[min(92vw,1040px)] lg:rounded-l-2xl",
          className,
        )}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const snapshot = scrollSnapshotRef.current;
          if (snapshot) snapshot.el.scrollTop = snapshot.top;
          lastFocusedRef.current?.focus();
        }}
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
          {decisionRail}
        </div>
      </SheetContent>
    </Sheet>
  );
}
