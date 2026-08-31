"use client";

import { useCallback, useEffect, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CoursewareStageViewport } from "@/features/courseware-doc/CoursewareStageViewport";
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
    || target.matches("input, textarea, select, [role='textbox']");
}

/**
 * 按钮只挡空格，不挡方向键。
 *
 * 空格是按钮的激活键，抢过来会让"点一下全屏、再按空格"变成翻页而不是再次全屏。
 * 方向键对按钮没有语义，而全屏之后焦点几乎必然停在刚点过的全屏按钮上——
 * 把方向键一起挡掉，等于全屏后就翻不了页了。
 */
function blocksPaging(target: EventTarget | null, key: string) {
  if (isEditableTarget(target)) return true;
  return key === " " && target instanceof HTMLElement && target.matches("button, [role='button']");
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
  toolbarTargetId,
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
  /** Optional mount point for an editable preview's drawing toolbar. */
  toolbarTargetId?: string;
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
  const commonT = useTranslations("common");
  const [elementRef, orientation] = useSplitOrientation(SIDE_BY_SIDE_MIN_WIDTH);
  const horizontal = orientation === "horizontal";
  const [fullscreen, setFullscreen] = useState(false);
  // 两个方向各存一份：横向记的是目录的像素宽，纵向记的是目录占的高度比例，
  // 混在一起会让转屏后的第一帧拿到一个属于另一个方向的数字。
  const { groupRef, onLayoutChanged } = usePanelLayout(`${layoutId}:${orientation}`);

  /*
   * 全屏（docs/plan/27 §3 D5/D6）。整块工作区进入全屏，目录、白板工具栏和翻页一起带上，
   * 教师在 iPad 上写板书时不必为了看清楚而牺牲跳讲能力。
   *
   * 纵横比必须保持等比：标注是逐轴归一化存的（x/w、y/h），直线与箭头的旋转角还按创建时的
   * 宽高比烘焙进了数据。舞台的 `aspectRatio` 与"取 min(宽, 高×比例)"的拟合逻辑在全屏下
   * 原样生效，所以放大后历史笔迹严格贴合，不需要迁移数据。
   *
   * 不接管手势翻页：舞台被 touch-none 的标注 canvas 完整覆盖，滑动会被识别成画笔。
   */
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === elementRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [elementRef]);

  const toggleFullscreen = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    if (document.fullscreenElement === element) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void element.requestFullscreen().catch(() => undefined);
  }, [elementRef]);

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
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (blocksPaging(event.target, event.key)) return;
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
      // 全屏元素默认是黑底且没有内边距；补上纸色与一圈呼吸，否则圆角卡片贴死屏幕边缘。
      className={cn("h-full min-h-0 min-w-0", fullscreen && "bg-paper p-3", className)}
      data-courseware-workbench
      data-courseware-workbench-mode="preview"
      data-courseware-preview-workspace
      data-orientation={orientation}
      data-fullscreen={fullscreen ? "true" : undefined}
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
        <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
          <span className="shrink-0 text-xs font-medium text-muted">{previewLabel}</span>
          {selectedPageLabel ? <span className="min-w-0 flex-1 truncate text-right text-xs text-muted">{selectedPageLabel}</span> : <span className="flex-1" />}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-courseware-preview-fullscreen
            className="size-7 shrink-0 rounded-full p-0 text-muted hover:text-ink"
            aria-pressed={fullscreen}
            aria-label={commonT(fullscreen ? "exitFullscreen" : "enterFullscreen")}
            title={commonT(fullscreen ? "exitFullscreen" : "enterFullscreen")}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Button>
        </div>
        <CoursewareStageViewport
          aspect={previewAspect}
          align="start"
          stageProps={{ "data-courseware-preview-stage": true } as HTMLAttributes<HTMLDivElement>}
        >
          {preview}
        </CoursewareStageViewport>
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
          {toolbarTargetId ? <div id={toolbarTargetId} className="flex min-w-0 flex-1 items-center justify-center overflow-hidden" /> : <span className="flex-1" />}
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
