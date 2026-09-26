import type { KeyboardEventHandler, PointerEventHandler, ReactNode } from "react";
import type { SpatialActionId } from "../spatial-interaction/actions";
import type { PlanarPoint, PlanarState, PlanarToolId } from "./contract";

export interface PlanarText { zh: string; en: string }
export const textFor = (text: PlanarText, locale: string) => locale === "en" ? text.en : text.zh;
export interface PlanarField {
  key: string; label: PlanarText; min: number; max: number; step?: number;
  options?: readonly { value: number; label: PlanarText }[];
  read?: (state: PlanarState) => number;
  disabled?: (state: PlanarState) => boolean;
}
export interface PlanarToggle { key: string; label: PlanarText }
export interface PlanarActionContext { selected: string | null }
export interface PlanarAction {
  id: string; icon: SpatialActionId; label: PlanarText;
  run: (state: PlanarState, context: PlanarActionContext) => PlanarState;
  duration?: number;
  interpolate?: (from: PlanarState, to: PlanarState, progress: number) => PlanarState;
  disabled?: (state: PlanarState, context: PlanarActionContext) => boolean;
  active?: (state: PlanarState) => boolean;
}
export interface PlanarMaterial {
  id: string; label: PlanarText; group: PlanarText; preview: ReactNode;
  add: (state: PlanarState) => PlanarState;
  disabled?: (state: PlanarState) => boolean;
}
export interface PlanarDrawingApi {
  locale: string; selected: string | null; editable: boolean;
  operation?: string | null;
  ghostState?: PlanarState;
  bind: (target: string, label?: string) => {
    onPointerDown?: PointerEventHandler<SVGElement>; onKeyDown?: KeyboardEventHandler<SVGElement>;
    role: "button"; tabIndex: number; "aria-label": string; "aria-pressed": boolean; "aria-disabled": boolean;
  };
}
export interface PlanarOperation {
  id: string; icon: SpatialActionId; label: PlanarText;
  fields?: readonly PlanarField[]; actions?: readonly PlanarAction[];
}
/** 未闭合的绘制过程只存在宿主本机；准确几何才进入历史与课堂。 */
export interface PlanarConstruction {
  tools: readonly { id: string; label: PlanarText; kind: "drag" | "points" }[];
  create: (state: PlanarState, toolId: string, points: readonly PlanarPoint[]) => PlanarState | null;
  preview: (toolId: string, points: readonly PlanarPoint[]) => ReactNode;
  maxPoints: number;
}
/** 共用宿主管按钮、指针、历史、动画、课堂；领域仅声明数学现场。坐标使用 960×720 舞台。 */
export interface PlanarSceneDefinition {
  id: string; toolId: PlanarToolId; title: PlanarText; description: PlanarText;
  create: () => PlanarState;
  progress?: boolean;
  fields?: readonly PlanarField[]; toggles?: readonly PlanarToggle[]; actions?: readonly PlanarAction[];
  materials?: readonly PlanarMaterial[];
  construction?: PlanarConstruction;
  operations?: readonly PlanarOperation[];
  /** 创建／复制／移除后让本机操作焦点跟随新材料；空白取消仍由宿主管理。 */
  selectionAfterChange?: (before: PlanarState, after: PlanarState, selected: string | null) => string | null;
  setField?: (state: PlanarState, key: string, value: number) => PlanarState;
  setFlag?: (state: PlanarState, key: string, value: boolean) => PlanarState;
  draw: (state: PlanarState, api: PlanarDrawingApi) => ReactNode;
  /** 起拖状态被冻结；point 是舞台位置，delta 是相对起拖的总位移。 */
  drag?: (start: PlanarState, target: string, point: PlanarPoint, delta: PlanarPoint, context?: { previous?: PlanarState }) => PlanarState;
  tap?: (state: PlanarState, target: string) => PlanarState;
  /** 拖动结束可返回合法吸附落点，共用宿主绘制细虚线轮廓并收拢。 */
  snap?: (state: PlanarState, target: string) => PlanarState | null;
  summary?: (state: PlanarState, locale: string) => string;
}
