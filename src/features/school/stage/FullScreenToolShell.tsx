"use client";

import { useState, type ReactNode } from "react";
import { PanelLeft, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * 全屏工具壳层（docs/plan/19-p4i-final.md §12.2 Studio 壳层）：顶部单工具栏
 * + 左侧 220px 页面列表 + 中间舞台（调用方自行用 `StageViewport` 包 children）
 * + 右侧 320px 属性栏 + 底部状态栏，固定宽度、不做可拖拽分栏（§12.2 未要求）。
 * `<1024` 时左右栏收进 `Sheet`（写法对齐 `DashboardShell.tsx` 现有移动端抽屉）。
 */
export function FullScreenToolShell({
  toolbar,
  leftPanel,
  leftPanelTitle,
  rightPanel,
  rightPanelTitle,
  statusBar,
  children,
  openLeftLabel,
  openRightLabel,
  closeLabel,
  className,
}: {
  toolbar: ReactNode;
  leftPanel?: ReactNode;
  leftPanelTitle?: string;
  rightPanel?: ReactNode;
  rightPanelTitle?: string;
  statusBar?: ReactNode;
  children: ReactNode;
  openLeftLabel?: string;
  openRightLabel?: string;
  closeLabel?: string;
  className?: string;
}) {
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2">
        {leftPanel ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="lg:hidden"
            aria-label={openLeftLabel}
            onClick={() => setLeftOpen(true)}
          >
            <PanelLeft size={16} />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">{toolbar}</div>
        {rightPanel ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="lg:hidden"
            aria-label={openRightLabel}
            onClick={() => setRightOpen(true)}
          >
            <PanelRight size={16} />
          </Button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        {leftPanel ? (
          <aside className="hidden w-[220px] shrink-0 overflow-y-auto border-r border-line lg:block">
            {leftPanel}
          </aside>
        ) : null}

        <div className="min-w-0 flex-1 overflow-hidden">{children}</div>

        {rightPanel ? (
          <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-line lg:block">
            {rightPanel}
          </aside>
        ) : null}
      </div>

      {statusBar}

      {leftPanel ? (
        <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
          <SheetContent side="left" closeLabel={closeLabel} className="flex w-[min(86vw,320px)] flex-col p-0">
            <SheetTitle className="sr-only">{leftPanelTitle}</SheetTitle>
            <div className="min-h-0 flex-1 overflow-y-auto">{leftPanel}</div>
          </SheetContent>
        </Sheet>
      ) : null}

      {rightPanel ? (
        <Sheet open={rightOpen} onOpenChange={setRightOpen}>
          <SheetContent side="right" closeLabel={closeLabel} className="flex w-[min(86vw,320px)] flex-col p-0">
            <SheetTitle className="sr-only">{rightPanelTitle}</SheetTitle>
            <div className="min-h-0 flex-1 overflow-y-auto">{rightPanel}</div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
