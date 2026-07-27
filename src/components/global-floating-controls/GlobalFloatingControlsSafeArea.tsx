import { GLOBAL_FLOATING_CONTROLS_INLINE_VAR, safeAreaInlineSize } from "./floating-controls.constants";

/**
 * 页头右侧的透明占位（docs/plan/21 §12.4）。真实参与 Grid 布局，
 * 因此标题区的可用范围自动收敛到 `C − 安全区`，不需要页面再写 `lg:pr-24`。
 */
export function GlobalFloatingControlsSafeArea() {
  return (
    <div
      aria-hidden="true"
      data-global-floating-controls-safe-area
      className="pointer-events-none shrink-0 select-none"
      style={{ inlineSize: safeAreaInlineSize(GLOBAL_FLOATING_CONTROLS_INLINE_VAR, "128px") }}
    />
  );
}
