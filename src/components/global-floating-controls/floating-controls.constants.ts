/**
 * 悬浮控制安全区的 CSS 变量契约（docs/plan/21 §12）。
 *
 * 变量写在 `document.documentElement` 上，读在页头的透明占位元素里；两侧都只认
 * 这几个名字，这样"控件长什么样"和"页头要让出多少"彻底解耦——控件增减一个按钮、
 * 换尺寸、切断点都不需要改页面。
 */

/** 视口右边缘 → 右上悬浮控件左边缘的距离（含呼吸）。 */
export const GLOBAL_FLOATING_CONTROLS_INLINE_VAR = "--global-floating-controls-safe-inline-size";
/** 视口上边缘 → 右上悬浮控件下边缘的距离（含呼吸）。 */
export const GLOBAL_FLOATING_CONTROLS_BLOCK_VAR = "--global-floating-controls-safe-block-size";
/** 视口左边缘 → 左上主入口右边缘的距离（含呼吸）。桌面端导航常驻时为 0。 */
export const MAIN_FLOATING_CONTROL_INLINE_VAR = "--main-floating-control-safe-inline-size";

/** 悬浮控件与相邻文本之间的最小呼吸，避免标题贴着按钮。 */
export const FLOATING_CONTROL_GAP = 12;

/**
 * 占位宽度 = 安全区 − Shell gutter。
 *
 * 安全区是相对**视口**测量的，而占位元素位于内容右边线 C（= 视口右边缘 − gutter），
 * 因此要把 gutter 那一段扣掉，否则每个页头都会多让出一个 gutter 的空白。
 */
export function safeAreaInlineSize(variable: string, fallback: string): string {
  return `max(0px, calc(var(${variable}, ${fallback}) - var(--dashboard-gutter, 0px)))`;
}
