import { MAIN_FLOATING_CONTROL_INLINE_VAR, safeAreaInlineSize } from "./floating-controls.constants";

/** 页头左侧的透明占位：只在左上存在悬浮主入口（移动端）时才有宽度。 */
export function MainFloatingControlSafeArea() {
  return (
    <div
      aria-hidden="true"
      data-main-floating-control-safe-area
      className="pointer-events-none shrink-0 select-none"
      style={{ inlineSize: safeAreaInlineSize(MAIN_FLOATING_CONTROL_INLINE_VAR, "64px") }}
    />
  );
}
