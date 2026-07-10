/**
 * 后台统一表单控件类名（P4C-0 §3.5）。
 * 原先各处裸 <select>/<input> 手写 `bg-background`——该 token 在 @theme 里未定义，
 * 实际渲染为透明底，叠在暗色卡片上出脏色。统一走 `bg-card + text-ink`，
 * 配合 globals.css 的 color-scheme 声明，原生下拉弹层随主题深浅。
 */
export const selectClass =
  "rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none transition focus:ring-2 focus:ring-moon";

export const inputClass = selectClass;
