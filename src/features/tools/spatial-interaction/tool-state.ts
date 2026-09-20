/** 面板明确声明其拾取方式；新增面板必须决定它操作对象、面、棱还是纸片。 */
export interface SpatialToolState<T extends string, P extends string> { tool: T; panel: P | null }
export interface SpatialToolDefinition<T extends string, P extends string> { defaultTool: T; panels: Record<P, T> }
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
