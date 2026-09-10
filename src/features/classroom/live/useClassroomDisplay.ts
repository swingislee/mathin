"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import { panelLayoutStorage } from "@/lib/panel-layout-storage";
import { pagingDialogIsOpen } from "./classroom-paging";
import {
  classroomDisplayBounds,
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

/** 显示偏好只属于当前设备和角色；课件、板书、页序与课堂事件保持原有身份。 */
export function useClassroomDisplay(scope: string, active: boolean, stageWidth: number, splitEnabled: boolean, workspaceRef: RefObject<HTMLDivElement | null>) {
  const [focused, setFocused] = useState(false);
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

  useEffect(() => {
    if (!focused || !active) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !pagingDialogIsOpen(document)) setFocused(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [active, focused]);

  const wide = size.width >= 1000;
  const adjustable = size.width > 0 && (focused || (splitEnabled && wide));
  const bounds = classroomDisplayBounds(size.width, size.height, focused);
  const preferred = focused ? preferences.focusPercent : preferences.splitPercent;
  const value = clampClassroomDisplayPercent(
    preferred ?? (focused ? bounds.maxPercent : Math.round(stageWidth / Math.max(1, size.width) * 100)), bounds,
  );
  const save = (next: typeof preferences) => {
    panelLayoutStorage.setItem(storageKey, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return {
    focused, setFocused, adjustable, bounds, value,
    splitWidth: !focused && adjustable && preferred !== null ? size.width * value / 100 : null,
    // 右栏压缩时把课程操作放到顶部；按用户偏好判断，避免高度变化反复触发换行。
    courseInfoAbove: !focused && adjustable && preferred !== null && size.width * (1 - preferred / 100) - 12 < 352,
    // 专注时仍用 4:3，同一 Canvas 随同一课件一起缩放。
    focusWidth: `min(${preferred ?? 100}cqw, calc(100cqh * 4 / 3))`,
    resize(percent: number) {
      save({ ...preferences, [focused ? "focusPercent" : "splitPercent"]: clampClassroomDisplayPercent(percent, bounds) });
    },
    reset() { save(DEFAULT_CLASSROOM_DISPLAY); },
  };
}
