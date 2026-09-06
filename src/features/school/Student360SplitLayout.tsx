"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { usePanelRef, type Layout, type LayoutChangedMeta, type PanelSize } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useSplitOrientation } from "@/hooks/use-split-orientation";
import { panelLayoutStorage } from "@/lib/panel-layout-storage";
import { cn } from "@/lib/utils";
import {
  defaultStudent360Width,
  parseStudent360Width,
  STUDENT_360_MAIN_MIN_WIDTH,
  STUDENT_360_SIDE_MIN_WIDTH,
  STUDENT_360_SPLIT_MIN_WIDTH,
  STUDENT_360_WIDTH_STORAGE_KEY,
} from "./student-360-layout-contract";

export function Student360SplitLayout({
  children,
  sidePage,
  active,
  expanded,
  close,
}: {
  children: ReactNode;
  sidePage: ReactNode;
  active: boolean;
  expanded: boolean;
  close: () => void;
}) {
  const t = useTranslations("school.student360");
  const [containerRef, orientation] = useSplitOrientation(STUDENT_360_SPLIT_MIN_WIDTH);
  const panelRef = usePanelRef();
  const desktop = orientation === "horizontal";
  const docked = desktop && expanded;
  const preferredWidth = useRef<number | null>(null);
  const [sideWidth, setSideWidth] = useState(416);

  useEffect(() => {
    preferredWidth.current = parseStudent360Width(panelLayoutStorage.getItem(STUDENT_360_WIDTH_STORAGE_KEY));
  }, []);

  useEffect(() => {
    if (!docked) return;
    const workspaceWidth = containerRef.current?.getBoundingClientRect().width ?? STUDENT_360_SPLIT_MIN_WIDTH;
    panelRef.current?.resize(preferredWidth.current ?? defaultStudent360Width(workspaceWidth));
  }, [containerRef, docked, panelRef]);

  const resizeSide = useCallback((size: PanelSize) => {
    // 关闭时保留最后的可见宽度，让同一份侧页内容完成原有滑出动画。
    if (size.inPixels > 0) setSideWidth(size.inPixels);
  }, []);

  const rememberWidth = useCallback((_layout: Layout, meta: LayoutChangedMeta) => {
    if (!docked || !meta.isUserInteraction) return;
    const width = panelRef.current?.getSize().inPixels;
    if (width === undefined || width < STUDENT_360_SIDE_MIN_WIDTH) return;
    preferredWidth.current = Math.round(width);
    panelLayoutStorage.setItem(STUDENT_360_WIDTH_STORAGE_KEY, String(preferredWidth.current));
  }, [docked, panelRef]);

  const resetWidth = useCallback(() => {
    if (!docked) return;
    const workspaceWidth = containerRef.current?.getBoundingClientRect().width ?? STUDENT_360_SPLIT_MIN_WIDTH;
    const width = defaultStudent360Width(workspaceWidth);
    panelRef.current?.resize(width);
    preferredWidth.current = width;
    panelLayoutStorage.setItem(STUDENT_360_WIDTH_STORAGE_KEY, String(width));
  }, [containerRef, docked, panelRef]);

  return (
    <div ref={containerRef} data-student-360-workspace data-student-360-layout={desktop ? "split" : "overlay"} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <ResizablePanelGroup id="student-360-panels" orientation="horizontal" disabled={!docked} onLayoutChanged={rememberWidth} className="min-h-0 min-w-0 flex-1">
        <ResizablePanel id="student-360-main" defaultSize="100%" minSize={docked ? STUDENT_360_MAIN_MIN_WIDTH : 0}>
          {children}
        </ResizablePanel>
        <ResizableHandle
          id="student-360-resize"
          withHandle
          disabled={!docked}
          disableDoubleClick
          aria-label={t("resizeSidePage")}
          title={t("resizeSidePageHint")}
          onDoubleClick={resetWidth}
          className={cn("z-[60]", !docked && "hidden")}
        />
        {/* 分栏负责真实占位；侧页始终保留在同一位置，开关和窄屏切换都不重挂主表或详情。 */}
        <ResizablePanel
          id="student-360-side-width"
          panelRef={panelRef}
          defaultSize={0}
          minSize={docked ? STUDENT_360_SIDE_MIN_WIDTH : 0}
          maxSize={docked ? "80%" : 0}
          groupResizeBehavior="preserve-pixel-size"
          onResize={resizeSide}
          aria-hidden="true"
        />
      </ResizablePanelGroup>
      {active && !desktop ? (
        <Button
          type="button"
          variant="ghost"
          tabIndex={-1}
          aria-label={t("close")}
          className={cn(
            "absolute inset-0 z-40 rounded-none bg-ink/35 p-0 transition-opacity duration-200 motion-reduce:transition-none",
            expanded ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={close}
        />
      ) : null}
      <aside
        id="student-360-side-page"
        data-student-360-side-page
        aria-labelledby={active ? "student-360-heading" : undefined}
        aria-hidden={!expanded}
        inert={!expanded || undefined}
        style={{ width: desktop ? sideWidth : "min(94vw,46rem)" }}
        className={cn(
          "absolute inset-y-0 right-0 z-50 flex flex-col overflow-x-hidden overflow-y-auto bg-paper transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
          !desktop && "border-l border-line shadow-xl",
          expanded ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-full opacity-0",
        )}
      >
        {sidePage}
      </aside>
    </div>
  );
}
