"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import { panelLayoutStorage } from "@/lib/panel-layout-storage";
import { viewportCenter, viewportPosition, type ClassroomViewport } from "./classroom-viewport";
import {
  classroomDisplayBounds,
  classroomFocusOffset,
  CLASSROOM_DISPLAY_ASPECT,
  clampClassroomDisplayPercent,
  DEFAULT_CLASSROOM_DISPLAY,
  parseClassroomDisplayPreferences,
} from "./classroom-display-layout";

const CHANGE_EVENT = "mathin-classroom-display-change";
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
const serverSnapshot = () => null;

/** 按当前设备换算显示尺寸；课件、板书和页序保持原有身份。 */
export function useClassroomDisplay(scope: string, active: boolean, stageWidth: number, workspaceRef: RefObject<HTMLDivElement | null>) {
  const [focused, setFocused] = useState(false);
  const [verticalPosition, setVerticalPosition] = useState(50);
  const [focusView, setFocusView] = useState<{ zoom: number; centerY: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const storageKey = `mathin:classroom-display:v1:${scope}`;
  const snapshot = useCallback(() => panelLayoutStorage.getItem(storageKey), [storageKey]);
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const preferences = useMemo(() => parseClassroomDisplayPreferences(raw), [raw]);

  useEffect(() => {
    const element = workspaceRef.current;
    if (!active || !element) return;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize((previous) => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [active, workspaceRef]);

  const adjustable = size.width > 0 && focused;
  const bounds = classroomDisplayBounds(size.width, size.height, focused);
  const preferred = focused ? preferences.focusPercent : null;
  const value = clampClassroomDisplayPercent(
    (focused && focusView ? focusView.zoom * bounds.fitPercent : preferred) ?? (focused ? bounds.fitPercent : Math.round(stageWidth / Math.max(1, size.width) * 100)), bounds,
  );
  const focusHeight = size.width * value / 100 / CLASSROOM_DISPLAY_ASPECT;
  const focusOverflow = Math.max(0, focusHeight - size.height);
  const position = focusView ? viewportPosition(focusHeight, size.height, focusView.centerY) : verticalPosition;
  const fullBounds = classroomDisplayBounds(size.width, size.height, true);
  const save = (next: typeof preferences) => {
    panelLayoutStorage.setItem(storageKey, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return {
    focused, setFocused, adjustable, bounds, value, size,
    viewport: { focused, zoom: focused ? value / bounds.fitPercent : focusView?.zoom ?? (preferences.focusPercent ?? fullBounds.fitPercent) / fullBounds.fitPercent,
      centerY: focusView?.centerY ?? viewportCenter(focusHeight, size.height, position) } satisfies ClassroomViewport,
    applyViewport(view: ClassroomViewport) { setFocused(view.focused); setFocusView({ zoom: view.zoom, centerY: view.centerY }); },
    rememberViewport(view: ClassroomViewport) {
      save({ ...preferences, focusPercent: Math.max(10, Math.min(100, view.zoom * classroomDisplayBounds(size.width, size.height, true).fitPercent)) });
    },
    // 专注时仍用 4:3，同一 Canvas 随同一课件一起缩放。
    focusWidth: `${value}cqw`,
    focusHeight: `${value / CLASSROOM_DISPLAY_ASPECT}cqw`,
    focusOffset: classroomFocusOffset(focusOverflow, position),
    verticalPosition: focused && focusOverflow > 0 ? position : null,
    setVerticalPosition,
    reset() { save(DEFAULT_CLASSROOM_DISPLAY); setVerticalPosition(50); setFocusView(null); },
  };
}
