"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import {
  H5_POINTER_MAX_MESSAGES_PER_SECOND,
  h5PointerGestureMessage,
  h5PointerParentMessage,
  parseH5PointerFrameMessage,
  type H5PointerBridgeHost,
  type H5PointerBridgeStatus,
  type H5PointerPoint,
} from "@/features/courseware-doc/h5-pointer-protocol";
import type { CanvasSurfaceInputPort, NormalizedInputPoint } from "@/features/whiteboard/CanvasSurface";
import type { Tool } from "@/features/whiteboard/types";
import {
  CLASSROOM_INPUT_CAPABILITY_VERSION,
  CLASSROOM_INPUT_PROVIDER_SCHEMA,
} from "./provider";
import {
  IDLE_CLASSROOM_INPUT_STATE,
  isClassroomInkTakeover,
  reduceClassroomInputRouter,
  type ClassroomInputRouterState,
  type ClassroomRoutingMode,
} from "./router";

interface FrameRegistration {
  frameId: string;
  iframe: HTMLIFrameElement;
  source: Window;
  channelToken: string;
  status: Exclude<H5PointerBridgeStatus, "disabled">;
  registeredAt: number;
  lastHelloAt: number;
  lastSeenAt: number;
  lastPingAt: number;
  rateWindowAt: number;
  rateCount: number;
}

interface FrozenH5Gesture {
  frame: FrameRegistration;
  pointerId: number;
  gestureToken: string;
  startClientX: number;
  startClientY: number;
  stageRect: { left: number; top: number; width: number; height: number };
  frameRect: { left: number; top: number; width: number; height: number };
  state: ClassroomInputRouterState;
  lastChunkSeq: number;
}

interface UseH5PointerBridgeOptions {
  stageRef: RefObject<HTMLElement | null>;
  inputPortRef: MutableRefObject<CanvasSurfaceInputPort | null>;
  enabled: boolean;
  expectedFrameCount: number;
  mode: ClassroomRoutingMode;
  tool: Tool;
  gestureKey: string;
  onInkStart?: () => void;
}

interface UseH5PointerBridgeResult {
  host: H5PointerBridgeHost | undefined;
  status: H5PointerBridgeStatus;
}

const HELLO_RETRY_MS = 400;
const HANDSHAKE_TIMEOUT_MS = 2_000;
const PING_INTERVAL_MS = 2_000;
const WATCHDOG_TIMEOUT_MS = 6_000;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizedStagePoint(
  point: H5PointerPoint,
  gesture: FrozenH5Gesture,
): NormalizedInputPoint {
  const clientX = gesture.frameRect.left + point.x * gesture.frameRect.width;
  const clientY = gesture.frameRect.top + point.y * gesture.frameRect.height;
  return [
    clamp01((clientX - gesture.stageRect.left) / Math.max(gesture.stageRect.width, 1)),
    clamp01((clientY - gesture.stageRect.top) / Math.max(gesture.stageRect.height, 1)),
  ];
}

function clientPoint(point: H5PointerPoint, gesture: FrozenH5Gesture): [number, number] {
  return [
    gesture.frameRect.left + point.x * gesture.frameRect.width,
    gesture.frameRect.top + point.y * gesture.frameRect.height,
  ];
}

function postToFrame(frame: FrameRegistration, message: Record<string, unknown>): void {
  frame.source.postMessage(message, "*");
}

export function useH5PointerBridge({
  stageRef,
  inputPortRef,
  enabled,
  expectedFrameCount,
  mode,
  tool,
  gestureKey,
  onInkStart,
}: UseH5PointerBridgeOptions): UseH5PointerBridgeResult {
  const framesRef = useRef(new Map<string, FrameRegistration>());
  const activeRef = useRef<FrozenH5Gesture | null>(null);
  const enabledRef = useRef(enabled);
  const expectedFrameCountRef = useRef(expectedFrameCount);
  const modeRef = useRef(mode);
  const toolRef = useRef(tool);
  const onInkStartRef = useRef(onInkStart);
  const gestureKeyRef = useRef(gestureKey);
  const [status, setStatus] = useState<H5PointerBridgeStatus>(enabled ? "pending" : "disabled");

  const recomputeStatus = useCallback(() => {
    if (!enabledRef.current) {
      setStatus("disabled");
      return;
    }
    const frames = [...framesRef.current.values()];
    if (frames.some((frame) => frame.status === "timeout")) {
      setStatus("timeout");
      return;
    }
    if (frames.some((frame) => frame.status === "incompatible")) {
      setStatus("incompatible");
      return;
    }
    if (expectedFrameCountRef.current > 0
        && frames.length === expectedFrameCountRef.current
        && frames.every((frame) => frame.status === "ready")) {
      setStatus("ready");
      return;
    }
    setStatus("pending");
  }, []);

  const abortActive = useCallback((frame?: FrameRegistration) => {
    const active = activeRef.current;
    if (!active || (frame && active.frame !== frame)) return;
    if (active.state.kind === "inking") inputPortRef.current?.cancel(active.pointerId);
    postToFrame(active.frame, h5PointerGestureMessage(
      "pointer_abort",
      active.frame.frameId,
      active.frame.channelToken,
      active.gestureToken,
    ));
    activeRef.current = null;
  }, [inputPortRef]);

  const registerFrame = useCallback((frameId: string, iframe: HTMLIFrameElement) => {
    const source = iframe.contentWindow;
    if (!source) return () => undefined;
    const existing = framesRef.current.get(frameId);
    if (existing) {
      abortActive(existing);
      framesRef.current.delete(frameId);
    }
    const now = performance.now();
    const frame: FrameRegistration = {
      frameId,
      iframe,
      source,
      channelToken: crypto.randomUUID(),
      status: "pending",
      registeredAt: now,
      lastHelloAt: now,
      lastSeenAt: now,
      lastPingAt: now,
      rateWindowAt: now,
      rateCount: 0,
    };
    framesRef.current.set(frameId, frame);
    postToFrame(frame, h5PointerParentMessage("pointer_hello", frameId, frame.channelToken));
    recomputeStatus();
    return () => {
      if (framesRef.current.get(frameId) !== frame) return;
      abortActive(frame);
      framesRef.current.delete(frameId);
      recomputeStatus();
    };
  }, [abortActive, recomputeStatus]);

  const host = useMemo<H5PointerBridgeHost | undefined>(
    () => enabled ? { registerFrame } : undefined,
    [enabled, registerFrame],
  );

  useEffect(() => {
    enabledRef.current = enabled;
    expectedFrameCountRef.current = expectedFrameCount;
    modeRef.current = mode;
    toolRef.current = tool;
    onInkStartRef.current = onInkStart;
    if (gestureKeyRef.current !== gestureKey) {
      gestureKeyRef.current = gestureKey;
      abortActive();
      framesRef.current.clear();
    }
    const bridgeMode = enabled && mode === "smart" && tool === "pen" ? "smart" : "interaction-lock";
    for (const frame of framesRef.current.values()) {
      if (frame.status !== "ready") continue;
      postToFrame(frame, h5PointerParentMessage(
        "pointer_mode",
        frame.frameId,
        frame.channelToken,
        { mode: bridgeMode },
      ));
    }
    if (bridgeMode !== "smart") abortActive();
    recomputeStatus();
  }, [abortActive, enabled, expectedFrameCount, gestureKey, mode, onInkStart, recomputeStatus, tool]);

  useEffect(() => {
    if (!enabled) return;
    const receive = (event: MessageEvent) => {
      const message = parseH5PointerFrameMessage(event.data);
      if (!message) return;
      const frame = framesRef.current.get(message.frameId);
      if (!frame
          || event.source !== frame.source
          || message.channelToken !== frame.channelToken) return;

      const now = performance.now();
      if (now - frame.rateWindowAt >= 1_000) {
        frame.rateWindowAt = now;
        frame.rateCount = 0;
      }
      frame.rateCount += 1;
      if (frame.rateCount > H5_POINTER_MAX_MESSAGES_PER_SECOND) {
        postToFrame(frame, h5PointerParentMessage(
          "pointer_mode",
          frame.frameId,
          frame.channelToken,
          { mode: "interaction-lock" },
        ));
        frame.status = "incompatible";
        abortActive(frame);
        recomputeStatus();
        return;
      }
      frame.lastSeenAt = now;

      if (message.type === "pointer_capabilities") {
        const compatible = message.providerSchema === CLASSROOM_INPUT_PROVIDER_SCHEMA
          && message.providerVersion === CLASSROOM_INPUT_CAPABILITY_VERSION;
        frame.status = compatible ? "ready" : "incompatible";
        if (compatible) {
          const bridgeMode = modeRef.current === "smart" && toolRef.current === "pen"
            ? "smart"
            : "interaction-lock";
          postToFrame(frame, h5PointerParentMessage(
            "pointer_ack",
            frame.frameId,
            frame.channelToken,
            { mode: bridgeMode },
          ));
        }
        recomputeStatus();
        return;
      }
      if (message.type === "pointer_pong") return;
      if (frame.status !== "ready"
          || !enabledRef.current
          || modeRef.current !== "smart"
          || toolRef.current !== "pen") return;

      if (message.type === "pointer_start") {
        if (activeRef.current) return;
        const stage = stageRef.current;
        if (!stage) return;
        const stageBounds = stage.getBoundingClientRect();
        const frameBounds = frame.iframe.getBoundingClientRect();
        const next = reduceClassroomInputRouter(IDLE_CLASSROOM_INPUT_STATE, {
          type: "pointer-down",
          pointerId: message.pointerId,
          pointerType: message.pointerType,
          isPrimary: message.isPrimary,
          button: message.button,
          mode: "smart",
          tool: "pen",
          capability: message.capability,
        });
        if (next.kind === "idle" || next.kind === "native-interaction") return;
        const startClientX = frameBounds.left + message.x * frameBounds.width;
        const startClientY = frameBounds.top + message.y * frameBounds.height;
        const active: FrozenH5Gesture = {
          frame,
          pointerId: message.pointerId,
          gestureToken: message.gestureToken,
          startClientX,
          startClientY,
          stageRect: {
            left: stageBounds.left,
            top: stageBounds.top,
            width: stageBounds.width,
            height: stageBounds.height,
          },
          frameRect: {
            left: frameBounds.left,
            top: frameBounds.top,
            width: frameBounds.width,
            height: frameBounds.height,
          },
          state: next,
          lastChunkSeq: 0,
        };
        activeRef.current = active;
        if (next.kind === "inking") {
          const point = normalizedStagePoint({ x: message.x, y: message.y }, active);
          if (!inputPortRef.current?.begin(message.pointerId, point)) {
            activeRef.current = null;
            postToFrame(frame, h5PointerGestureMessage(
              "pointer_abort",
              frame.frameId,
              frame.channelToken,
              message.gestureToken,
            ));
            return;
          }
          onInkStartRef.current?.();
          postToFrame(frame, h5PointerGestureMessage(
            "pointer_takeover",
            frame.frameId,
            frame.channelToken,
            message.gestureToken,
          ));
        }
        return;
      }

      const active = activeRef.current;
      if (!active
          || active.frame !== frame
          || active.pointerId !== message.pointerId
          || active.gestureToken !== message.gestureToken) return;

      if ((message.type === "pointer_move" || message.type === "pointer_end")) {
        if (message.chunkSeq <= active.lastChunkSeq) return;
        active.lastChunkSeq = message.chunkSeq;
      }

      if (message.type === "pointer_move") {
        if (active.state.kind === "pending-click") {
          const maxMovementPx = message.points.reduce((maximum, point) => {
            const [clientX, clientY] = clientPoint(point, active);
            return Math.max(maximum, Math.hypot(
              clientX - active.startClientX,
              clientY - active.startClientY,
            ));
          }, 0);
          const previous = active.state;
          active.state = reduceClassroomInputRouter(active.state, {
            type: "pointer-move",
            pointerId: message.pointerId,
            maxMovementPx,
          });
          if (isClassroomInkTakeover(previous, active.state)) {
            const start = normalizedStagePoint({
              x: (active.startClientX - active.frameRect.left) / Math.max(active.frameRect.width, 1),
              y: (active.startClientY - active.frameRect.top) / Math.max(active.frameRect.height, 1),
            }, active);
            if (!inputPortRef.current?.begin(message.pointerId, start)) {
              abortActive(frame);
              return;
            }
            onInkStartRef.current?.();
            postToFrame(frame, h5PointerGestureMessage(
              "pointer_takeover",
              frame.frameId,
              frame.channelToken,
              message.gestureToken,
            ));
          }
        }
        if (active.state.kind === "inking" && message.points.length > 0) {
          inputPortRef.current?.append(
            message.pointerId,
            message.points.map((point) => normalizedStagePoint(point, active)),
          );
        }
        return;
      }

      if (message.type === "pointer_end") {
        if (active.state.kind === "inking") {
          inputPortRef.current?.finish(
            message.pointerId,
            message.points.map((point) => normalizedStagePoint(point, active)),
          );
        }
        activeRef.current = null;
        return;
      }

      if (message.type === "pointer_cancel") {
        if (active.state.kind === "inking") inputPortRef.current?.cancel(message.pointerId);
        activeRef.current = null;
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [abortActive, enabled, inputPortRef, recomputeStatus, stageRef]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      for (const frame of framesRef.current.values()) {
        if (frame.status === "pending") {
          if (now - frame.registeredAt >= HANDSHAKE_TIMEOUT_MS) {
            frame.status = "timeout";
            continue;
          }
          if (now - frame.lastHelloAt >= HELLO_RETRY_MS) {
            frame.lastHelloAt = now;
            postToFrame(frame, h5PointerParentMessage(
              "pointer_hello",
              frame.frameId,
              frame.channelToken,
            ));
          }
          continue;
        }
        if (frame.status !== "ready") continue;
        if (now - frame.lastSeenAt >= WATCHDOG_TIMEOUT_MS) {
          postToFrame(frame, h5PointerParentMessage(
            "pointer_mode",
            frame.frameId,
            frame.channelToken,
            { mode: "interaction-lock" },
          ));
          frame.status = "timeout";
          abortActive(frame);
          continue;
        }
        if (now - frame.lastPingAt >= PING_INTERVAL_MS) {
          frame.lastPingAt = now;
          postToFrame(frame, h5PointerParentMessage(
            "pointer_ping",
            frame.frameId,
            frame.channelToken,
          ));
        }
      }
      recomputeStatus();
    }, 250);
    return () => window.clearInterval(timer);
  }, [abortActive, enabled, recomputeStatus]);

  useEffect(() => {
    if (!enabled) return;
    const cancel = () => abortActive();
    const visibility = () => {
      if (document.visibilityState === "hidden") cancel();
    };
    const stage = stageRef.current;
    const observer = stage ? new ResizeObserver(cancel) : null;
    if (stage) observer?.observe(stage);
    window.addEventListener("blur", cancel);
    window.addEventListener("pagehide", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer?.disconnect();
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pagehide", cancel);
      document.removeEventListener("visibilitychange", visibility);
      cancel();
    };
  }, [abortActive, enabled, stageRef]);

  return { host, status };
}
