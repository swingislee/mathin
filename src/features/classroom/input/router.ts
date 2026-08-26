export const CLASSROOM_SMART_TAKEOVER_PX = 8;

export type ClassroomRoutingMode = "smart" | "interaction-lock" | "ink-lock";
export type ClassroomInputCapability = "click" | "drag" | "native" | "ink" | "unknown";

/**
 * Smart is a single teacher preference. When it is off or unavailable, the
 * selected whiteboard tool provides the unambiguous v1 fallback ownership.
 */
export function resolveClassroomRoutingMode({
  smartEnabled,
  smartAvailable,
  tool,
}: {
  smartEnabled: boolean;
  smartAvailable: boolean;
  tool: "pointer" | "drawing";
}): ClassroomRoutingMode {
  if (smartEnabled && smartAvailable) return "smart";
  return tool === "pointer" ? "interaction-lock" : "ink-lock";
}

export type ClassroomInputRouterState =
  | { kind: "idle" }
  | { kind: "pending-click"; pointerId: number; maxMovementPx: number }
  | { kind: "inking"; pointerId: number }
  | { kind: "native-interaction"; pointerId: number };

export type ClassroomInputRouterEvent =
  | {
      type: "pointer-down";
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;
      button: number;
      mode: ClassroomRoutingMode;
      tool: "pen" | "other";
      capability: ClassroomInputCapability;
    }
  | { type: "pointer-move"; pointerId: number; maxMovementPx: number; thresholdPx?: number }
  | { type: "pointer-end"; pointerId: number }
  | { type: "pointer-cancel"; pointerId: number }
  | { type: "reset" };

export const IDLE_CLASSROOM_INPUT_STATE: ClassroomInputRouterState = { kind: "idle" };

/** Pure gesture ownership reducer. pointerType is diagnostic only and never changes routing. */
export function reduceClassroomInputRouter(
  state: ClassroomInputRouterState,
  event: ClassroomInputRouterEvent,
): ClassroomInputRouterState {
  if (event.type === "reset") return IDLE_CLASSROOM_INPUT_STATE;
  if (event.type === "pointer-down") {
    if (state.kind !== "idle" || !event.isPrimary || event.button !== 0) return state;
    if (event.mode === "interaction-lock") {
      return { kind: "native-interaction", pointerId: event.pointerId };
    }
    if (event.mode === "ink-lock" || event.tool !== "pen" || event.capability === "ink") {
      return { kind: "inking", pointerId: event.pointerId };
    }
    if (event.capability === "click") {
      return { kind: "pending-click", pointerId: event.pointerId, maxMovementPx: 0 };
    }
    return { kind: "native-interaction", pointerId: event.pointerId };
  }
  if (state.kind === "idle" || event.pointerId !== state.pointerId) return state;
  if (event.type === "pointer-move" && state.kind === "pending-click") {
    const maxMovementPx = Math.max(state.maxMovementPx, event.maxMovementPx);
    return maxMovementPx >= (event.thresholdPx ?? CLASSROOM_SMART_TAKEOVER_PX)
      ? { kind: "inking", pointerId: state.pointerId }
      : { ...state, maxMovementPx };
  }
  if (event.type === "pointer-end" || event.type === "pointer-cancel") {
    return IDLE_CLASSROOM_INPUT_STATE;
  }
  return state;
}

export function isClassroomInkTakeover(
  previous: ClassroomInputRouterState,
  next: ClassroomInputRouterState,
): boolean {
  return previous.kind === "pending-click" && next.kind === "inking";
}
