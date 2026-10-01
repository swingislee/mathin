import type { PlanarState } from "./contract";
import type { PlanarAction, PlanarOperation, PlanarSceneDefinition } from "./types";

export type ResolvedPlanarContextAction = { kind: "action"; item: PlanarAction } | { kind: "operation"; item: PlanarOperation };

/** 只解析现有声明，不复制领域回调或持久化局部选择。 */
export function resolvePlanarContextActions(definition: PlanarSceneDefinition, state: PlanarState, selected: string | null) {
  if (!selected) return null;
  const context = definition.contextActions?.(state, selected);
  if (!context || !Object.values(context.bounds).every(Number.isFinite)
    || context.bounds.minX > context.bounds.maxX || context.bounds.minY > context.bounds.maxY) return null;
  const actions = [...definition.actions ?? [], ...definition.operations?.flatMap((operation) => operation.actions ?? []) ?? []];
  const items: ResolvedPlanarContextAction[] = [];
  for (const reference of context.items) {
    if (reference.kind === "action") {
      const item = actions.find((action) => action.id === reference.id);
      if (item && !items.some((entry) => entry.item.icon === item.icon)) items.push({ kind: "action", item });
    } else {
      const item = definition.operations?.find((operation) => operation.id === reference.id);
      if (item && !items.some((entry) => entry.item.icon === item.icon)) items.push({ kind: "operation", item });
    }
    if (items.length === 5) break;
  }
  return items.length ? { bounds: context.bounds, items } : null;
}
