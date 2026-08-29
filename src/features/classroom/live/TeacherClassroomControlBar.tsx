"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { classifyClassroomToolTrayGesture } from "./classroom-tool-tray";

/** Fixed optical-glass dock aligned to the teacher body's two columns. */
export function TeacherClassroomControlBar({
  inputControls,
  drawingControls,
  pageControls,
  utilityControls,
}: {
  inputControls: ReactNode;
  drawingControls: (expanded: boolean) => ReactNode;
  pageControls: ReactNode;
  utilityControls: ReactNode;
}) {
  const t = useTranslations("classroom.live");
  const [toolTrayExpanded, setToolTrayExpanded] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    const touch = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !touch) return;

    const gesture = classifyClassroomToolTrayGesture(start, {
      x: touch.clientX,
      y: touch.clientY,
    });
    if (gesture === "expand") setToolTrayExpanded(true);
    if (gesture === "collapse") setToolTrayExpanded(false);
  };

  return (
    <footer
      className="fixed inset-x-3 bottom-2 z-[70] grid h-[calc(3.5rem+env(safe-area-inset-bottom))] grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded-[1.4rem] bg-paper/30 px-2 pb-[env(safe-area-inset-bottom)] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),inset_0_-1px_0_rgba(0,0,0,0.16),0_10px_32px_rgba(0,0,0,0.22)] ring-1 ring-inset ring-white/10 backdrop-blur-xl backdrop-saturate-150 lg:grid-cols-[minmax(0,1fr)_clamp(22rem,31vw,36rem)] lg:gap-3 lg:px-3"
      data-classroom-control-bar="full-width"
      data-classroom-control-surface="flat-rail"
      data-classroom-control-background="optical-glass"
    >
      <div className="relative min-w-0">
        <div
          className={cn(
            "overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            toolTrayExpanded
              ? "fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[71] max-h-[min(60dvh,26rem)] touch-pan-y overflow-y-auto rounded-[1.4rem] bg-paper/80 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(0,0,0,0.14),0_14px_36px_rgba(0,0,0,0.24)] ring-1 ring-inset ring-white/15 backdrop-blur-xl backdrop-saturate-150 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-150"
              : "h-11 touch-pan-x overflow-x-auto overflow-y-hidden",
            "lg:static lg:h-auto lg:max-h-none lg:overflow-visible lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0 lg:backdrop-blur-none lg:backdrop-saturate-100",
          )}
          data-classroom-tool-tray={toolTrayExpanded ? "expanded" : "collapsed"}
          data-tool-tray-gesture="horizontal-browse-upward-expand"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={() => { touchStart.current = null; }}
        >
          <div className={cn(
            "flex min-w-max items-center gap-1.5",
            toolTrayExpanded && "min-w-0 flex-wrap content-center justify-center",
            "lg:min-w-0 lg:flex-nowrap lg:justify-start",
          )}>
            <button
              type="button"
              aria-expanded={toolTrayExpanded}
              aria-label={toolTrayExpanded ? t("collapseToolTray") : t("expandToolTray")}
              title={toolTrayExpanded ? t("collapseToolTray") : t("expandToolTray")}
              onClick={() => setToolTrayExpanded((expanded) => !expanded)}
              className="grid h-11 w-6 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-moon/30 hover:text-ink lg:hidden"
              data-classroom-tool-tray-toggle
            >
              {toolTrayExpanded ? <ChevronDown aria-hidden size={16} /> : <ChevronUp aria-hidden size={16} />}
            </button>
            <div className="flex shrink-0 items-center gap-1.5" data-classroom-control-zone="input">{inputControls}</div>
            <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-line" />
            <div className={cn("min-w-0", toolTrayExpanded && "w-full", "lg:ml-auto lg:w-auto")}>
              {drawingControls(toolTrayExpanded)}
            </div>
          </div>
        </div>
      </div>
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-0.5 border-l border-line pl-1.5 lg:gap-1.5 lg:pl-3">
        <div className="flex shrink-0 items-center" data-classroom-control-zone="pages">{pageControls}</div>
        <span aria-hidden className="h-6 w-px shrink-0 bg-line" />
        <div className="flex shrink-0 items-center" data-classroom-control-zone="utility">{utilityControls}</div>
      </div>
    </footer>
  );
}
