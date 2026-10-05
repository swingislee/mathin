"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import {
  DASHBOARD_SIDEBAR_DEFAULT_WIDTH,
  DASHBOARD_SIDEBAR_ICON_WIDTH,
  DASHBOARD_SIDEBAR_MAX_WIDTH,
  DASHBOARD_SIDEBAR_TEXT_MIN_WIDTH,
  normalizeDashboardSidebarWidth,
} from "./dashboard-sidebar";

type Drag = { pointerId: number; startX: number; startWidth: number };

/** 独立分隔条保持主工作区挂载；拖动只预览，松手才保存偏好。 */
export function DashboardSidebarResizeHandle({
  width,
  sidebarId,
  onResize,
}: {
  width: number;
  sidebarId: string;
  onResize: (width: number, commit: boolean) => void;
}) {
  const t = useTranslations("dashboard.shell");
  const drag = useRef<Drag | null>(null);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    if (!resizing) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [resizing]);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
    setResizing(true);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    onResize(normalizeDashboardSidebarWidth(current.startWidth + event.clientX - current.startX), false);
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
    onResize(commit
      ? normalizeDashboardSidebarWidth(current.startWidth + event.clientX - current.startX)
      : current.startWidth, commit);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && drag.current) {
      const current = drag.current;
      drag.current = null;
      setResizing(false);
      onResize(current.startWidth, false);
      if (event.currentTarget.hasPointerCapture(current.pointerId)) {
        event.currentTarget.releasePointerCapture(current.pointerId);
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (drag.current || event.altKey || event.ctrlKey || event.metaKey) return;
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = width <= DASHBOARD_SIDEBAR_TEXT_MIN_WIDTH ? DASHBOARD_SIDEBAR_ICON_WIDTH : width - 16;
        break;
      case "ArrowRight":
        next = width === DASHBOARD_SIDEBAR_ICON_WIDTH ? DASHBOARD_SIDEBAR_TEXT_MIN_WIDTH : width + 16;
        break;
      case "Home": next = DASHBOARD_SIDEBAR_ICON_WIDTH; break;
      case "End": next = DASHBOARD_SIDEBAR_MAX_WIDTH; break;
      case "Enter": next = DASHBOARD_SIDEBAR_DEFAULT_WIDTH; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    onResize(normalizeDashboardSidebarWidth(next), true);
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t("resizeNav")}
      aria-controls={sidebarId}
      aria-orientation="vertical"
      aria-valuemin={DASHBOARD_SIDEBAR_ICON_WIDTH}
      aria-valuemax={DASHBOARD_SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      aria-valuetext={width === DASHBOARD_SIDEBAR_ICON_WIDTH ? t("iconsOnly") : t("navWidth", { width })}
      title={t("resizeNavHint")}
      data-dashboard-sidebar-resize
      data-resizing={resizing || undefined}
      className={cn(
        "group/resize absolute inset-y-0 left-full z-20 flex w-4 touch-none select-none items-center cursor-col-resize focus-visible:outline-none",
        "before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-line hover:before:w-0.5 hover:before:bg-crater focus-visible:before:w-0.5 focus-visible:before:bg-crater",
        resizing && "before:w-0.5 before:bg-crater",
      )}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={(event) => finishDrag(event, true)}
      onPointerCancel={(event) => finishDrag(event, false)}
      onLostPointerCapture={(event) => finishDrag(event, false)}
      onKeyDown={resizeWithKeyboard}
      onDoubleClick={() => onResize(DASHBOARD_SIDEBAR_DEFAULT_WIDTH, true)}
    >
      <span
        aria-hidden
        className={cn(
          "relative h-8 w-1 -translate-x-1/2 rounded-full bg-crater/50 transition-colors group-hover/resize:bg-crater group-focus-visible/resize:bg-crater",
          resizing && "bg-crater",
        )}
      />
    </div>
  );
}
