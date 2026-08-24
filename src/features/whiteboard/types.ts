export type Tool =
  | "pointer"
  | "pen"
  | "shape"
  | "eraserS"
  | "eraserM"
  | "eraserL"
  | "strokeEraser";

/** 画笔七色：存 token 名而非色值，绘制时解析当前主题的 CSS 变量（08-§3.2）。 */
export const COLOR_TOKENS = ["ink", "rose", "blue", "leaf", "crater", "cheek", "moon"] as const;
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

export const SHAPE_KINDS = [
  "line",
  "arrow",
  "rectangle",
  "ellipse",
  "triangle",
  "rightTriangle",
  "diamond",
  "pentagon",
  "hexagon",
  "star",
  "arc",
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/**
 * 几何对象使用中心点 + 归一化宽高 + 角度，避免把画布像素写入快照。
 * arc 的 startAngle/sweepAngle 只由圆规作图产生，不出现在普通形状面板。
 */
export interface ShapeItem {
  id: string;
  kind: "shape";
  shape: ShapeKind;
  color: ColorToken;
  fill: ColorToken | null;
  strokeWidthNorm: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  startAngle?: number;
  sweepAngle?: number;
}

export type BoardItem = StrokeItem | ShapeItem;

export const INSTRUMENT_KINDS = ["ruler", "compass", "protractor"] as const;
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];

/** 尺规是本机临时教具；作图结果进入 items，教具本身不持久化也不广播。 */
export interface InstrumentItem {
  id: string;
  kind: InstrumentKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  radius?: number;
  armAngle?: number;
}

export function isStrokeItem(item: BoardItem): item is StrokeItem {
  return !("kind" in item);
}

export function isShapeItem(item: BoardItem): item is ShapeItem {
  return "kind" in item && item.kind === "shape";
}

export interface WhiteboardMeta {
  id: string;
  title: string;
  updatedAt: string;
}

export interface WhiteboardRecord extends WhiteboardMeta {
  snapshot: BoardItem[];
  /** 快照乐观锁版本；每次成功落盘递增。 */
  version: number;
  canEdit: boolean;
  isOwner: boolean;
  ownerId: string;
  /** 仅 owner 可见（经 security definer RPC 读取），其余为 null。 */
  inviteCode: string | null;
}

export interface WhiteboardMemberInfo {
  userId: string;
  displayName: string;
  canEdit: boolean;
}

/** 协同 op：广播与本地事件共用同一形状（08-§3.2）。 */
export type BoardOp =
  | { t: "commit"; item: BoardItem }
  | { t: "replace"; item: BoardItem }
  | { t: "erase"; id: string }
  | { t: "clear" }
  | { t: "restore"; items: BoardItem[] };

/** 绘制中的增量点（节流广播，对端画在 draft 层）。 */
export interface ProgressChunk {
  /** v2 chunks are numbered per stroke from zero; omitted means legacy best-effort stream. */
  seq?: number;
  id: string;
  mode: StrokeMode;
  color: ColorToken;
  wNorm: number;
  points: Array<[number, number]>;
  done?: boolean;
}

export interface CursorPayload {
  key: string;
  name: string;
  x: number;
  y: number;
}

export interface PeerInfo {
  key: string;
  name: string;
}
