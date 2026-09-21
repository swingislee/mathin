"use client";

import { useCallback, useState, type KeyboardEvent, type PointerEvent } from "react";
import { reduceSpatialToolState, type SpatialToolDefinition, type SpatialToolEvent, type SpatialToolState } from "./tool-state";

/** 模式、参数面板与退出共用一次原子更新；显示开关和一次性命令留在领域状态中。 */
export function useSpatialToolState<T extends string, P extends string>(definition: SpatialToolDefinition<T, P>, initial?: Partial<SpatialToolState<T, P>>) {
  const [state, setState] = useState<SpatialToolState<T, P>>(() => ({ tool: initial?.tool ?? (initial?.panel ? definition.panels[initial.panel] : definition.defaultTool), panel: initial?.panel ?? null }));
  // 旧快照可要求保留当前对象 ID；取消选中只关闭本机操作焦点，不升级保存合同。
  const [selectionActive, setSelectionActive] = useState(true);
  const activateSelection = useCallback(() => setSelectionActive(true), []);
  const dispatch = (event: SpatialToolEvent<T, P>) => setState((current) => reduceSpatialToolState(current, event, definition));
  const closePanel = () => dispatch({ kind: "close" });
  const clearSelection = () => { setSelectionActive(false); definition.onClearSelection?.(); closePanel(); };
  return {
    ...state, closePanel, selectionActive, activateSelection, clearSelection,
    // Canvas 的 missed 只在共用指针保护放行的轻点后生效；拖动、双指和取消不会到达这里。
    onPointerMissed: (event: MouseEvent) => {
      if (event.type === "click" && event.button === 0 && !event.defaultPrevented) clearSelection();
    },
    chooseTool: (tool: T, panel?: P | null) => dispatch({ kind: "tool", tool, panel, toggle: true }),
    setTool: (tool: T) => dispatch({ kind: "tool", tool }),
    togglePanel: (panel: P, tool?: T) => dispatch({ kind: "panel", panel, tool, toggle: true }),
    setPanel: (panel: P | null, tool?: T) => panel === null ? closePanel() : dispatch({ kind: "panel", panel, tool }),
    hidePanel: () => dispatch({ kind: "hide-panel" }),
    bindings: {
      tabIndex: -1,
      onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
        if ((event.target as HTMLElement).tagName === "CANVAS") event.currentTarget.focus({ preventScroll: true });
      },
      "data-spatial-tool": state.tool,
      "data-spatial-panel": state.panel ?? "none",
      // 限于当前工作台；多个课件工具实例不会互相关闭。输入框保留自身键盘行为。
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === "Escape" && !event.defaultPrevented && !(event.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) clearSelection();
      },
    },
  };
}
