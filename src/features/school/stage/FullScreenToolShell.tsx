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
 *
 * 两栏的常驻档位不同（docs/plan/27 §5.1 H5）：左栏 `lg` 起常驻，右栏推到 `xl`。
 * 原先两者共用 `lg`，1024 视口上一次吃掉 540px，舞台只剩 484px 承载 1280–1920 宽的
 * 课件画布；而收起入口又恰好在同一档 `lg:hidden` 消失，没有任何逃生口。
 * 现在两栏在各自的常驻档里都能手动收起，收起后按钮换成抽屉入口。
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
  const [leftDocked, setLeftDocked] = useState(true);
  const [rightDocked, setRightDocked] = useState(true);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2">
        {leftPanel ? (
          <>
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="hidden lg:inline-flex"
              aria-label={openLeftLabel}
              aria-pressed={leftDocked}
              onClick={() => setLeftDocked((value) => !value)}
            >
              <PanelLeft size={16} />
            </Button>
          </>
        ) : null}
        <div className="min-w-0 flex-1">{toolbar}</div>
        {rightPanel ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="xl:hidden"
              aria-label={openRightLabel}
              onClick={() => setRightOpen(true)}
            >
              <PanelRight size={16} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="hidden xl:inline-flex"
              aria-label={openRightLabel}
              aria-pressed={rightDocked}
              onClick={() => setRightDocked((value) => !value)}
            >
              <PanelRight size={16} />
            </Button>
          </>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        {leftPanel && leftDocked ? (
          <aside className="hidden w-[220px] shrink-0 overflow-y-auto border-r border-line lg:block">
            {leftPanel}
          </aside>
        ) : null}

        <div className="min-w-0 flex-1 overflow-hidden">{children}</div>

        {rightPanel && rightDocked ? (
          <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-line xl:block">
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
          <SheetContent side="right" closeLabel={closeLabel} className="flex w-[min(86vw,340px)] flex-col p-0">
            <SheetTitle className="sr-only">{rightPanelTitle}</SheetTitle>
            <div className="min-h-0 flex-1 overflow-y-auto">{rightPanel}</div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
