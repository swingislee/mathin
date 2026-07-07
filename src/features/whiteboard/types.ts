export type Tool = "pointer" | "pen" | "eraserS" | "eraserM" | "eraserL" | "strokeEraser";

/** 画笔六色：存 token 名而非色值，绘制时解析当前主题的 CSS 变量（08-§3.2）。 */
export const COLOR_TOKENS = ["ink", "rose", "leaf", "crater", "cheek", "moon"] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

export type StrokeMode = "ink" | "erase";

/**
 * 一条绘制项。坐标与线宽均相对 16:9 逻辑画布归一化（0–1，以 CSS 像素为基准，
 * 修正旧版 CSS px / 设备 px 混用的偏差）。mode="erase" 是可重放的碎擦笔迹：
 * 快照按序重放即可完整还原画面（修正旧版快照丢碎擦的 bug）。
 */
export interface StrokeItem {
  id: string;
  mode: StrokeMode;
  color: ColorToken;
  wNorm: number;
  points: Array<[number, number]>;
}

export interface WhiteboardMeta {
  id: string;
  title: string;
  updatedAt: string;
}

export interface WhiteboardRecord extends WhiteboardMeta {
  snapshot: StrokeItem[];
  canEdit: boolean;
}
