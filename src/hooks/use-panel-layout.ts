"use client";

import { useEffect, useRef } from "react";
import { useDefaultLayout, useGroupRef } from "react-resizable-panels";
import { panelLayoutStorage } from "@/lib/panel-layout-storage";

/**
 * 可拖拽分栏的布局持久化（docs/plan/27 §3 D3）。
 *
 * 存档要走命令式回填，而不是 Group 的 `defaultLayout` prop，原因有两层：
 *
 * 1. Panel 的 `defaultSize` 优先于 Group 的 `defaultLayout`。两者同时给，存档永远不生效；
 *    而像素下限与首次默认宽度必须由 `defaultSize` 表达，不能让给百分比。
 * 2. 这些工作区都会先在服务端渲染一次。`useDefaultLayout` 内部是 `useSyncExternalStore`，
 *    hydration 用的是服务端快照（没有 localStorage，恒为空），面板在那一帧就已经按
 *    默认值注册完约束；等客户端快照到位时改 prop 已经晚了。
 *
 * 所以：默认值仍由 `defaultSize` 决定，挂载后若读到存档再 `setLayout` 覆盖一次。
 * 代价是拖过的布局会有一帧默认宽度，换来的是没拖过的人拿到正确的像素默认值。
 *
 * `onlySaveAfterUserInteractions`：只记教师亲手拖出来的布局。否则窗口每变一次尺寸都会
 * 把当时算出的相对比例写回存储，像素下限与 preserve-pixel-size 全部作废。
 */
export function usePanelLayout(id: string) {
  const groupRef = useGroupRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id,
    onlySaveAfterUserInteractions: true,
    storage: panelLayoutStorage,
  });
  const restoredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!defaultLayout || restoredFor.current === id) return;
    const group = groupRef.current;
    if (!group) return;
    restoredFor.current = id;
    group.setLayout(defaultLayout);
  }, [defaultLayout, groupRef, id]);

  return { groupRef, onLayoutChanged };
}
