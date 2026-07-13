/**
 * 后台统一表单控件类名（P4C-0 §3.5）。
 * 原先各处裸 <select>/<input> 手写 `bg-background`——该 token 在 @theme 里未定义，
 * 实际渲染为透明底，叠在暗色卡片上出脏色。统一走 `bg-card + text-ink`，
 * 配合 globals.css 的 color-scheme 声明，原生下拉弹层随主题深浅。
 */
export const selectClass =
  "rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none transition focus:ring-2 focus:ring-moon";

export const inputClass = selectClass;

/**
 * shadcn Select（Radix）禁止 SelectItem 的 value 为空字符串，但业务里大量筛选/表单
 * 用 "" 表示「全部/不设置」。用非空哨兵值在 JSX 边界转换，state/查询参数仍是空字符串语义。
 */
export const SELECT_ALL_VALUE = "__all__";
export const toSelectValue = (v: string) => v || SELECT_ALL_VALUE;
export const fromSelectValue = (v: string) => (v === SELECT_ALL_VALUE ? "" : v);
