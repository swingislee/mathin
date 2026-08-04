"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { usePanelLayout } from "@/hooks/use-panel-layout";
import { useSplitOrientation } from "@/hooks/use-split-orientation";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * 目录与预览并排所需的最小工作区宽度（docs/plan/27 §4）。
 *
 * 阈值是按 4:3 舞台的实际边长算出来的，不是按"看起来够宽"。舞台边长
 * `min(预览宽, 预览高 × 4/3)`：上下分栏时预览只拿到约 2/3 的高度，横向分栏时拿到全高。
 * 在 800 高的视口上，两者的交叉点落在工作区宽约 500px——比这更宽，横向分栏的舞台更大。
 * 取 560 留一档余量。
 */
const SIDE_BY_SIDE_MIN_WIDTH = 560;

/** 目录列的像素合同：wide 用于备课工作区（行内有勾选与状态），standard 用于只读复核。 */
const RAIL_DEFAULT_SIZE = { standard: 200, wide: 224 } as const;
const RAIL_MIN_SIZE = 180;
const PREVIEW_MIN_SIZE = 320;

export interface CoursewarePreviewListItem {
  id: string;
  title: string;
  href?: string;
  leading?: ReactNode;
  titleContent?: ReactNode;
  trailing?: ReactNode;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || target.matches("input, textarea, select, button, [role='textbox']");
}

/**
 * Shared courseware viewer: a persistent page rail plus an aspect-correct preview.
 * Callers may add editing/check controls to rail rows, while read-only consumers
 * simply pass titles (and optional hrefs). The preview is fitted to the actual
 * remaining width and height instead of extending the page by its full-width ratio.
 */
export function CoursewarePreviewWorkspace({
  items,
  selectedIndex,
  onSelectedIndexChange,
  directoryLabel,
  previewLabel,
  previousLabel,
  nextLabel,
  keyboardHint,
  selectedPageLabel,
  railStatus,
  railFooter,
  preview,
  previewAspect = 4 / 3,
  railWidth = "standard",
  layoutId = "courseware-preview",
  className,
}: {
  items: CoursewarePreviewListItem[];
  selectedIndex: number;
  onSelectedIndexChange?: (index: number) => void;
  directoryLabel: string;
  previewLabel: string;
  previousLabel: string;
  nextLabel: string;
  keyboardHint: string;
  selectedPageLabel?: string;
  railStatus?: ReactNode;
  railFooter?: ReactNode;
  preview: ReactNode;
  previewAspect?: number;
  railWidth?: "standard" | "wide";
  /** 拖拽布局的持久化标识；同一页面里的两个预览工作区必须给不同值。 */
  layoutId?: string;
  className?: string;
}) {
  const router = useRouter();
  const previewBodyRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState<number | null>(null);
  const [elementRef, orientation] = useSplitOrientation(SIDE_BY_SIDE_MIN_WIDTH);
  const horizontal = orientation === "horizontal";
  // 两个方向各存一份：横向记的是目录的像素宽，纵向记的是目录占的高度比例，
  // 混在一起会让转屏后的第一帧拿到一个属于另一个方向的数字。
  const { groupRef, onLayoutChanged } = usePanelLayout(`${layoutId}:${orientation}`);

  useEffect(() => {
    const body = previewBodyRef.current;
    if (!body) return;
    const fit = () => {
      const { width, height } = body.getBoundingClientRect();
      setStageWidth(Math.max(0, Math.floor(Math.min(width, height * previewAspect))));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(body);
    fit();
    return () => observer.disconnect();
  }, [previewAspect]);

  const goTo = useCallback((index: number) => {
    const item = items[index];
    if (!item) return;
    if (item.href) {
      router.push(item.href);
      return;
    }
    onSelectedIndexChange?.(index);
  }, [items, onSelectedIndexChange, router]);

  const goPrevious = useCallback(() => goTo(selectedIndex - 1), [goTo, selectedIndex]);
  const goNext = useCallback(() => goTo(selectedIndex + 1), [goTo, selectedIndex]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return;
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        if (selectedIndex <= 0) return;
        event.preventDefault();
        goPrevious();
      } else if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        if (selectedIndex >= items.length - 1) return;
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrevious, items.length, selectedIndex]);

  const selectByKeyboard = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectedIndexChange?.(index);
  };

  return (
    <ResizablePanelGroup
      elementRef={elementRef}
      groupRef={groupRef}
      orientation={orientation}
      onLayoutChanged={onLayoutChanged}
      className={cn("h-full min-h-0 min-w-0", className)}
      data-courseware-preview-workspace
      data-orientation={orientation}
    >
      <ResizablePanel
        id="rail"
        minSize={horizontal ? RAIL_MIN_SIZE : "18%"}
        maxSize={horizontal ? "45%" : "50%"}
        defaultSize={horizontal ? RAIL_DEFAULT_SIZE[railWidth] : "32%"}
        // 目录是一份定宽列表：窗口变宽时多出来的像素应该全部给舞台，
        // 默认的等比分配会让目录一起变宽，4:3 舞台反而拿不到增量。
        groupResizeBehavior={horizontal ? "preserve-pixel-size" : undefined}
        className="overflow-hidden rounded-2xl border border-line bg-card"
        data-courseware-page-rail
      >
        <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted">{directoryLabel}</span>
          {railStatus}
        </div>
        <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {items.map((item, index) => {
            const active = selectedIndex === index;
            const content = (
              <>
                <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted">{index + 1}</span>
                {item.leading}
                <span className="min-w-0 flex-1">{item.titleContent ?? <span className="block truncate text-xs text-ink">{item.title}</span>}</span>
                {item.trailing}
              </>
            );
            const rowClass = cn(
              "group flex min-h-11 items-center gap-1.5 px-2 py-1.5 transition-colors",
              active ? "bg-crater/10" : "bg-line/10 hover:bg-moon/20",
            );
            return (
              <li key={item.id}>
                {item.href ? (
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={item.title}
                    className={rowClass}
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-current={active ? "page" : undefined}
                    title={item.title}
                    onClick={() => onSelectedIndexChange?.(index)}
                    onKeyDown={(event) => selectByKeyboard(event, index)}
                    className={cn(rowClass, "cursor-pointer")}
                  >
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {railFooter ? <div className="shrink-0 border-t border-line p-1.5">{railFooter}</div> : null}
      </ResizablePanel>

      <ResizableHandle withHandle orientation={orientation} className={horizontal ? "mx-1.5" : "my-1.5"} />

      <ResizablePanel
        id="preview"
        minSize={horizontal ? PREVIEW_MIN_SIZE : "30%"}
        className="overflow-hidden rounded-2xl border border-line bg-moon/10"
        data-courseware-preview
      >
        <div className="flex min-h-10 shrink-0 items-center justify-between border-b border-line px-3 py-2">
          <span className="text-xs font-medium text-muted">{previewLabel}</span>
          {selectedPageLabel ? <span className="min-w-0 truncate pl-4 text-xs text-muted">{selectedPageLabel}</span> : null}
        </div>
        <div ref={previewBodyRef} className="flex min-h-0 flex-1 items-start justify-center overflow-hidden">
          <div
            className="shrink-0 overflow-hidden bg-card"
            data-courseware-preview-stage
            style={{
              width: stageWidth === null ? "100%" : stageWidth,
              aspectRatio: String(previewAspect),
            }}
          >
            {preview}
          </div>
        </div>
        <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-t border-line px-2 py-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={selectedIndex <= 0}
            aria-keyshortcuts="ArrowLeft PageUp"
            onClick={goPrevious}
          >
            <ChevronLeft size={15} />
            {previousLabel}
          </Button>
          <span className="hidden min-w-0 truncate text-center text-[11px] text-muted sm:block">{keyboardHint}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={selectedIndex >= items.length - 1}
            aria-keyshortcuts="ArrowRight PageDown Space"
            onClick={goNext}
          >
            {nextLabel}
            <ChevronRight size={15} />
          </Button>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
