/**
 * 历史遗留的表单控件类名（P4C-0 §3.5）。P4F-3 已把全部原生 <select> 迁到 shadcn
 * Select，`selectClass` 现在只剩几处 <Input> 上的补充 className（多为历史遗留的
 * 重复覆盖，Input 自身默认样式已含等价效果），不再对应任何 <select> 元素。
 * 暂不删除/合并——留给下一次碰这些文件的人顺手清理。
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
