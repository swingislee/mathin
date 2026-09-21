/** 面板明确声明其拾取方式；新增面板必须决定它操作对象、面、棱还是纸片。 */
export interface SpatialToolState<T extends string, P extends string> { tool: T; panel: P | null }
export type SpatialTransformMode = "move" | "rotate";
export interface SpatialToolDefinition<T extends string, P extends string> {
  defaultTool: T; panels: Record<P, T>;
  /** 只有主动打开这些操作面板才显示变换手柄；选择、观察和属性面板默认留白。 */
  transformPanels?: Partial<Record<P, SpatialTransformMode>>;
  /** 清理本机选中/拾取反馈，不复原模型或写入教学快照。 */
  onClearSelection?: () => void;
}
export function spatialTransformMode<T extends string, P extends string>(state: SpatialToolState<T, P>, definition: SpatialToolDefinition<T, P>): SpatialTransformMode | null {
  return state.panel ? definition.transformPanels?.[state.panel] ?? null : null;
}
export type SpatialToolEvent<T extends string, P extends string> =
  | { kind: "tool"; tool: T; panel?: P | null; toggle?: boolean }
  | { kind: "panel"; panel: P; tool?: T; toggle?: boolean }
  | { kind: "close" }
  | { kind: "hide-panel" };

export function reduceSpatialToolState<T extends string, P extends string>(state: SpatialToolState<T, P>, event: SpatialToolEvent<T, P>, definition: SpatialToolDefinition<T, P>): SpatialToolState<T, P> {
  const reset = { tool: definition.defaultTool, panel: null };
  switch (event.kind) {
    case "close": return reset;
    // 完成分割拾取后收起参数，并保留舞台上的确认手柄；仅用于这一类领域流程。
    case "hide-panel": return { ...state, panel: null };
    case "tool": return event.toggle && state.tool === event.tool
      ? reset : { tool: event.tool, panel: event.panel ?? null };
    case "panel": return event.toggle && state.panel === event.panel && (!event.tool || state.tool === event.tool)
      ? reset : { tool: event.tool ?? definition.panels[event.panel], panel: event.panel };
  }
}
