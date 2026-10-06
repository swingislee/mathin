"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/** 按真实控件尺寸决定筛选是否同行，兼容侧栏拖动、字体加载与异步命令面板。 */
export function DashboardPageHeaderLayout({ children, className }: { children: ReactNode; className: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const layout = ref.current;
    if (!layout) return;
    let frame = 0;
    let active = true;

    const fit = () => {
      frame = 0;
      if (!active) return;
      const panel = layout.querySelector<HTMLElement>("[data-dashboard-page-commands] > [data-dashboard-command-panel]");
      const filters = panel?.querySelector<HTMLElement>(":scope > [data-dashboard-command-slot=filters]");
      // 手机由容器规则编排；筛选不存在时让剩余空间留给视图和主操作。
      if (layout.clientWidth < 640 || !panel || !filters || filters.getClientRects().length === 0) {
        layout.dataset.dashboardHeaderFit = "stacked";
        return;
      }

      // 同一帧内试排并测量，不复制控件，也不重新挂载输入、焦点或业务状态。
      layout.dataset.dashboardHeaderFit = "inline";
      const slots = panel.querySelectorAll<HTMLElement>(":scope > [data-dashboard-command-slot]");
      const fits = layout.scrollWidth <= layout.clientWidth + 1 && [...slots].every(slot => (
        slot.getClientRects().length === 0
        || (slot.getBoundingClientRect().height <= 52 && slot.scrollWidth <= slot.clientWidth + 1)
      ));
      layout.dataset.dashboardHeaderFit = fits ? "inline" : "stacked";
    };

    const schedule = () => {
      if (active && !frame) frame = requestAnimationFrame(fit);
    };
    // 只响应宽度变化，试排产生的高度变化不会触发循环测量。
    const widths = new WeakMap<Element, number>();
    const resize = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (widths.get(entry.target) !== entry.contentRect.width) {
          widths.set(entry.target, entry.contentRect.width);
          schedule();
        }
      }
    });
    resize.observe(layout);
    layout.querySelectorAll("[data-main-floating-control-safe-area], [data-global-floating-controls-safe-area]").forEach(element => resize.observe(element));
    const content = new MutationObserver(schedule);
    content.observe(layout, { childList: true, characterData: true, subtree: true });
    void document.fonts.ready.then(schedule);
    fit();

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      content.disconnect();
    };
  }, []);

  return <div ref={ref} data-dashboard-header-layout className={className}>{children}</div>;
}
