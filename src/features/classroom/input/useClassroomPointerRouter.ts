"use client";

import { useEffect, type MutableRefObject, type RefObject } from "react";
import type {
  CanvasSurfaceInputPort,
  NormalizedInputPoint,
} from "@/features/whiteboard/CanvasSurface";
import type { Tool } from "@/features/whiteboard/types";
import {
  parseClassroomInputCapability,
  type ClassroomRendererInputProfile,
} from "./capabilities";
import {
  IDLE_CLASSROOM_INPUT_STATE,
  isClassroomInkTakeover,
  reduceClassroomInputRouter,
  type ClassroomInputRouterState,
  type ClassroomRoutingMode,
} from "./router";

interface FrozenGesture {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  rect: { left: number; top: number; width: number; height: number };
  clickOwner: Element | null;
  startedAsClick: boolean;
}

interface ClickSuppressionToken {
  pointerId: number;
  owner: Element | null;
}

interface ClassroomPointerRouterOptions {
  stageRef: RefObject<HTMLElement | null>;
  inputPortRef: MutableRefObject<CanvasSurfaceInputPort | null>;
  enabled: boolean;
  mode: ClassroomRoutingMode;
  tool: Tool;
  profile: ClassroomRendererInputProfile;
  gestureKey: string;
  onInkStart?: () => void;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizedPoint(
  clientX: number,
  clientY: number,
  rect: FrozenGesture["rect"],
): NormalizedInputPoint {
  return [
    clamp01((clientX - rect.left) / Math.max(rect.width, 1)),
    clamp01((clientY - rect.top) / Math.max(rect.height, 1)),
  ];
}

function eventPoints(event: PointerEvent, rect: FrozenGesture["rect"]): NormalizedInputPoint[] {
  const coalesced = event.getCoalescedEvents?.() ?? [];
  const source = coalesced.length ? coalesced : [event];
  const points = source.map((point) => normalizedPoint(point.clientX, point.clientY, rect));
  const current = normalizedPoint(event.clientX, event.clientY, rect);
  const last = points.at(-1);
  if (!last || last[0] !== current[0] || last[1] !== current[1]) points.push(current);
  return points;
}

function targetCapability(
  event: PointerEvent,
  profile: ClassroomRendererInputProfile,
): { capability: ReturnType<typeof parseClassroomInputCapability>; owner: Element | null } {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element) || !target.hasAttribute("data-classroom-input")) continue;
    return {
      capability: parseClassroomInputCapability(target.getAttribute("data-classroom-input"), profile),
      owner: target,
    };
  }
  return { capability: parseClassroomInputCapability(null, profile), owner: null };
}

function clickBelongsToToken(event: MouseEvent, token: ClickSuppressionToken): boolean {
  const clickPointerId = "pointerId" in event ? Number(event.pointerId) : null;
  if (clickPointerId !== null && Number.isFinite(clickPointerId) && clickPointerId > 0) {
    return clickPointerId === token.pointerId;
  }
  if (!token.owner || !(event.target instanceof Node)) return true;
  return token.owner === event.target || token.owner.contains(event.target);
}

/**
 * Owns Smart + pen gestures at the common courseware/board stage. The hook never
 * searches the DOM after pointerdown and never synthesizes a click.
 */
export function useClassroomPointerRouter({
  stageRef,
  inputPortRef,
  enabled,
  mode,
  tool,
  profile,
  gestureKey,
  onInkStart,
}: ClassroomPointerRouterOptions): void {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !enabled) return;

    let state: ClassroomInputRouterState = IDLE_CLASSROOM_INPUT_STATE;
    let gesture: FrozenGesture | null = null;
    let suppression: ClickSuppressionToken | null = null;
    let suppressionTimer: number | null = null;
    const previousTouchAction = stage.style.touchAction;
    stage.style.touchAction = "none";

    const clearSuppression = () => {
      suppression = null;
      if (suppressionTimer !== null) window.clearTimeout(suppressionTimer);
      suppressionTimer = null;
    };

    const releaseCapture = (pointerId: number) => {
      try {
        if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    };

    const resetGesture = () => {
      state = IDLE_CLASSROOM_INPUT_STATE;
      gesture = null;
    };

    const preventInkPropagation = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const beginInk = (event: PointerEvent, frozen: FrozenGesture): boolean => {
      const port = inputPortRef.current;
      if (!port?.begin(
        event.pointerId,
        normalizedPoint(frozen.startClientX, frozen.startClientY, frozen.rect),
      )) return false;
      onInkStart?.();
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer sources may not implement capture.
      }
      return true;
    };

    const pointerDown = (event: PointerEvent) => {
      if (state.kind !== "idle") return;
      const target = targetCapability(event, profile);
      const next = reduceClassroomInputRouter(state, {
        type: "pointer-down",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        button: event.button,
        mode,
        tool: tool === "pen" ? "pen" : "other",
        capability: target.capability,
      });
      if (next.kind === "idle") return;
      const bounds = stage.getBoundingClientRect();
      gesture = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        rect: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
        clickOwner: target.owner,
        startedAsClick: next.kind === "pending-click",
      };
      state = next;
      if (next.kind !== "inking") return;
      if (!beginInk(event, gesture)) {
        resetGesture();
        return;
      }
      preventInkPropagation(event);
    };

    const pointerMove = (event: PointerEvent) => {
      const active = gesture;
      if (!active || active.pointerId !== event.pointerId) return;
      if (state.kind === "pending-click") {
        const candidates = event.getCoalescedEvents?.() ?? [event];
        const maxMovementPx = candidates.reduce((maximum, point) => Math.max(
          maximum,
          Math.hypot(point.clientX - active.startClientX, point.clientY - active.startClientY),
        ), Math.hypot(event.clientX - active.startClientX, event.clientY - active.startClientY));
        const previous = state;
        const next = reduceClassroomInputRouter(state, {
          type: "pointer-move",
          pointerId: event.pointerId,
          maxMovementPx,
        });
        state = next;
        if (!isClassroomInkTakeover(previous, next)) return;
        if (!beginInk(event, active)) {
          resetGesture();
          return;
        }
        suppression = { pointerId: event.pointerId, owner: active.clickOwner };
      }
      if (state.kind !== "inking") return;
      inputPortRef.current?.append(event.pointerId, eventPoints(event, active.rect));
      preventInkPropagation(event);
    };

    const pointerUp = (event: PointerEvent) => {
      const active = gesture;
      if (!active || active.pointerId !== event.pointerId) return;
      if (state.kind === "inking") {
        inputPortRef.current?.finish(event.pointerId, eventPoints(event, active.rect));
        releaseCapture(event.pointerId);
        preventInkPropagation(event);
        if (suppression) {
          const token = suppression;
          suppressionTimer = window.setTimeout(() => {
            if (suppression === token) suppression = null;
            suppressionTimer = null;
          }, 0);
        }
      }
      state = reduceClassroomInputRouter(state, { type: "pointer-end", pointerId: event.pointerId });
      gesture = null;
    };

    const pointerCancel = (event: PointerEvent) => {
      const active = gesture;
      if (!active || active.pointerId !== event.pointerId) return;
      if (state.kind === "inking") inputPortRef.current?.cancel(event.pointerId);
      releaseCapture(event.pointerId);
      clearSuppression();
      state = reduceClassroomInputRouter(state, { type: "pointer-cancel", pointerId: event.pointerId });
      gesture = null;
    };

    const lostPointerCapture = (event: PointerEvent) => {
      const active = gesture;
      if (!active || active.pointerId !== event.pointerId || state.kind !== "inking") return;
      inputPortRef.current?.finish(event.pointerId);
      resetGesture();
    };

    const windowPointerEnd = (event: PointerEvent) => {
      const active = gesture;
      if (!active || active.pointerId !== event.pointerId || state.kind === "inking") return;
      state = reduceClassroomInputRouter(state, { type: "pointer-end", pointerId: event.pointerId });
      gesture = null;
    };

    const cancelLifecycle = () => {
      const active = gesture;
      if (active && state.kind === "inking") inputPortRef.current?.cancel(active.pointerId);
      if (active) releaseCapture(active.pointerId);
      clearSuppression();
      resetGesture();
    };

    const visibilityChange = () => {
      if (document.visibilityState === "hidden") cancelLifecycle();
    };

    const clickCapture = (event: MouseEvent) => {
      if (!suppression || !clickBelongsToToken(event, suppression)) return;
      event.preventDefault();
      event.stopPropagation();
      clearSuppression();
    };

    const resizeObserver = new ResizeObserver(cancelLifecycle);
    resizeObserver.observe(stage);
    stage.addEventListener("pointerdown", pointerDown, true);
    stage.addEventListener("pointermove", pointerMove, true);
    stage.addEventListener("pointerup", pointerUp, true);
    stage.addEventListener("pointercancel", pointerCancel, true);
    stage.addEventListener("lostpointercapture", lostPointerCapture, true);
    stage.addEventListener("click", clickCapture, true);
    window.addEventListener("pointerup", windowPointerEnd);
    window.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("blur", cancelLifecycle);
    window.addEventListener("pagehide", cancelLifecycle);
    document.addEventListener("visibilitychange", visibilityChange);

    return () => {
      cancelLifecycle();
      resizeObserver.disconnect();
      stage.style.touchAction = previousTouchAction;
      stage.removeEventListener("pointerdown", pointerDown, true);
      stage.removeEventListener("pointermove", pointerMove, true);
      stage.removeEventListener("pointerup", pointerUp, true);
      stage.removeEventListener("pointercancel", pointerCancel, true);
      stage.removeEventListener("lostpointercapture", lostPointerCapture, true);
      stage.removeEventListener("click", clickCapture, true);
      window.removeEventListener("pointerup", windowPointerEnd);
      window.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("blur", cancelLifecycle);
      window.removeEventListener("pagehide", cancelLifecycle);
      document.removeEventListener("visibilitychange", visibilityChange);
    };
  }, [enabled, gestureKey, inputPortRef, mode, onInkStart, profile, stageRef, tool]);
}
