"use client";

import { useEffect, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { newId } from "@/lib/uuid";
import type { CanvasSurfaceInputPort, NormalizedInputPoint } from "@/features/whiteboard/CanvasSurface";
import { isPalmContact, palmEraserDiameter, MAX_CONTACT_SIZE } from "../input/palm-eraser";
import {
  CLASSROOM_VIEWPORT_PROTOCOL, beginViewportGesture, moveViewportGesture,
  type ViewportGestureStart, type ViewportTouch,
} from "./classroom-viewport";

export interface ClassroomPalmInput {
  threshold: number;
  inputPortRef: MutableRefObject<CanvasSurfaceInputPort | null>;
  penPointers: MutableRefObject<Set<string>>;
  onStart: () => void;
  onCancelInput?: () => void;
}
interface Touch extends ViewportTouch {
  pointerId: number;
  clientX: number;
  width: number;
  height: number;
  target?: EventTarget | null;
}
interface PalmGesture {
  key: string;
  pointerId: number;
  origin: NormalizedInputPoint;
  rect: { left: number; top: number; width: number; height: number };
  eraserWidth: number;
  port: CanvasSurfaceInputPort | null;
}

/** 共同裁决掌擦与双指：已识别手掌临时擦除，双指缩放独立锁定到本次触控结束。 */
export function useClassroomViewportGestures({ enabled, stageRef, gestureKey, percent, min, max, onChange, onEnd, onCancelInk, palm }: {
  enabled: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  gestureKey: string;
  percent: number;
  min: number;
  max: number;
  onChange: (percent: number, centerY: number) => void;
  onEnd: () => void;
  onCancelInk: (pointerId: number) => void;
  palm?: ClassroomPalmInput;
}) {
  const current = useRef({ percent, min, max, onChange, onEnd, onCancelInk, palm });
  useLayoutEffect(() => { current.current = { percent, min, max, onChange, onEnd, onCancelInk, palm }; });
  const palmThreshold = palm?.threshold ?? 0;
  useEffect(() => {
    const stage = stageRef.current;
    if ((!enabled && !palmThreshold) || !stage) return;
    const viewport = stage.parentElement!;
    const host = stage.ownerDocument.defaultView!;
    const touches = new Map<string, Touch>();
    const frames = new Map<HTMLIFrameElement, string>();
    const ownPens = new Set<string>();
    const penScope = newId();
    const penPointers = current.current.palm?.penPointers.current ?? new Set<string>();
    let gesture: ViewportGestureStart | null = null;
    let palmGesture: PalmGesture | null = null;
    let pair: string[] = [];
    let reserved = false, cancelling = false;
    let suppressUntil = 0, raf = 0;
    const normalize = (point: Touch, rect: PalmGesture["rect"]): NormalizedInputPoint => [
      Math.max(0, Math.min(1, (point.clientX - rect.left) / Math.max(1, rect.width))),
      Math.max(0, Math.min(1, (point.clientY - rect.top) / Math.max(1, rect.height))),
    ];
    const configure = (frame: HTMLIFrameElement, active: boolean) => {
      let token = frames.get(frame);
      if (!token) { token = newId(); frames.set(frame, token); }
      const rect = frame.getBoundingClientRect();
      frame.contentWindow?.postMessage({ protocol: CLASSROOM_VIEWPORT_PROTOCOL, type: "configure", enabled: active, token,
        viewport: enabled, palmThreshold: active ? palmThreshold : 0,
        scaleX: rect.width / Math.max(1, frame.clientWidth || rect.width), scaleY: rect.height / Math.max(1, frame.clientHeight || rect.height) }, "*");
    };
    const reserve = (active: boolean) => {
      reserved = active;
      for (const [frame, token] of frames) frame.contentWindow?.postMessage({ protocol: CLASSROOM_VIEWPORT_PROTOCOL, type: "reserve", active, token }, "*");
    };
    const cancelHostTouches = () => {
      cancelling = true;
      for (const [key, point] of touches) {
        if (!key.startsWith("host:")) continue;
        current.current.onCancelInk(point.pointerId);
        point.target?.dispatchEvent(new PointerEvent("pointercancel", { pointerId: point.pointerId, pointerType: "touch", bubbles: true }));
        try { stage.setPointerCapture(point.pointerId); } catch {}
      }
      cancelling = false;
    };
    const flush = () => {
      raf = 0;
      if (!gesture || pair.some((key) => !touches.has(key))) return;
      const result = moveViewportGesture(gesture, pair.map((key) => touches.get(key)!), viewport.getBoundingClientRect(), current.current.min, current.current.max);
      current.current.onChange(result.percent, result.centerY);
    };
    const startViewport = () => {
      if (!enabled || reserved || touches.size < 2) return;
      pair = [...touches.keys()].slice(0, 2);
      gesture = beginViewportGesture(pair.map((key) => touches.get(key)!), current.current.percent, stage.getBoundingClientRect());
      reserve(true); cancelHostTouches();
    };
    const stopPalm = (commit: boolean, point?: Touch) => {
      if (!palmGesture) return;
      if (palmGesture.port) {
        if (commit) palmGesture.port.finish(palmGesture.pointerId, point ? [normalize(point, palmGesture.rect)] : []);
        else palmGesture.port.cancel(palmGesture.pointerId);
      }
      palmGesture = null;
    };
    const pen = (key: string, active: boolean) => {
      key = `${penScope}:${key}`;
      if (active) { ownPens.add(key); penPointers.add(key); stopPalm(false); }
      else { ownPens.delete(key); penPointers.delete(key); }
    };
    const accept = (phase: string, key: string, point: Touch): boolean => {
      if (phase === "down") {
        if (touches.size >= 10) return reserved;
      } else if (!touches.has(key)) return false;
      touches.set(key, point);
      const canDetect = current.current.palm && (phase === "down" || phase === "move");
      if (!reserved && canDetect && isPalmContact(point, palmThreshold)) {
        reserve(true); cancelHostTouches();
        if (penPointers.size === 0) {
          current.current.palm?.onCancelInput?.();
          current.current.palm?.inputPortRef.current?.cancelActive?.();
          const rect = stage.getBoundingClientRect();
          palmGesture = { key, pointerId: point.pointerId, rect, origin: normalize(point, rect),
            eraserWidth: Math.min(1, palmEraserDiameter(point) / Math.max(1, rect.width)), port: null };
        }
      }
      if (palmGesture?.key === key && (phase === "down" || phase === "move") && penPointers.size === 0) {
        if (!palmGesture.port && isPalmContact(point, palmThreshold)) {
          const port = current.current.palm?.inputPortRef.current;
          if (port?.begin(point.pointerId, palmGesture.origin, { eraserWidth: palmGesture.eraserWidth })) {
            palmGesture.port = port;
            current.current.palm?.onStart();
          }
        }
        if (phase === "move") palmGesture.port?.append(point.pointerId, [normalize(point, palmGesture.rect)]);
      }
      if (!reserved && phase !== "up" && phase !== "cancel") startViewport();
      if (phase === "move" && gesture && !raf) raf = requestAnimationFrame(flush);
      const owned = reserved;
      if (phase === "up" || phase === "cancel") {
        if (palmGesture?.key === key) stopPalm(phase === "up", point);
        if (gesture && pair.includes(key)) {
          if (raf) { cancelAnimationFrame(raf); flush(); }
          gesture = null; current.current.onEnd();
        }
        touches.delete(key);
        if (owned) suppressUntil = performance.now() + 600;
        if (touches.size === 0) reserve(false);
        try { if (key.startsWith("host:") && stage.hasPointerCapture(point.pointerId)) stage.releasePointerCapture(point.pointerId); } catch {}
      }
      return owned;
    };
    const pointer = (event: PointerEvent) => {
      if (cancelling) return;
      const phase = { pointerdown: "down", pointermove: "move", pointerup: "up", pointercancel: "cancel" }[event.type];
      if (event.pointerType === "pen") {
        if (phase !== "move" || typeof event.buttons === "number") pen(`host:${event.pointerId}`, phase === "down" || (phase === "move" && (event.buttons & 1) !== 0));
        return;
      }
      if (event.pointerType !== "touch" || !phase) return;
      const key = `host:${event.pointerId}`, previous = touches.get(key);
      if (phase === "down" && (!(event.target instanceof Node) || !stage.contains(event.target))) return;
      const point: Touch = { x: event.screenX, y: event.screenY, clientX: event.clientX, clientY: event.clientY,
        width: event.width, height: event.height, target: previous?.target ?? event.target, pointerId: event.pointerId };
      if (accept(phase, key, point)) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const cancel = () => {
      stopPalm(false);
      if (gesture) current.current.onEnd();
      gesture = null; touches.clear(); reserve(false);
      for (const key of ownPens) penPointers.delete(key);
      ownPens.clear();
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.protocol !== CLASSROOM_VIEWPORT_PROTOCOL) return;
      const frame = [...frames.keys()].find((candidate) => candidate.contentWindow === event.source);
      if (!frame) return;
      if (data.type === "hello") { configure(frame, true); return; }
      if (data.token !== frames.get(frame)) return;
      if (data.type === "cancel-all") { cancel(); return; }
      if (!Number.isSafeInteger(data.id) || !["down", "move", "up", "cancel"].includes(data.phase)) return;
      const key = `${data.token}:${data.id}`;
      if (data.type === "pen") { pen(key, data.phase === "down" || data.phase === "move"); return; }
      if (data.type !== "touch" || ![data.x, data.y, data.ny].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e6)
        || data.ny < 0 || data.ny > 1 || [data.nx, data.nw, data.nh].some((n) => n !== undefined && (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1))) return;
      const rect = frame.getBoundingClientRect();
      const point = { x: data.x, y: data.y, clientX: rect.left + (data.nx ?? 0.5) * rect.width, clientY: rect.top + data.ny * rect.height,
        width: (data.nw ?? 0) * rect.width, height: (data.nh ?? 0) * rect.height, pointerId: data.id };
      if (point.width > MAX_CONTACT_SIZE || point.height > MAX_CONTACT_SIZE) return;
      accept(data.phase, key, point);
    };
    const visibility = () => { if (stage.ownerDocument.hidden) cancel(); };
    const click = (event: MouseEvent) => {
      if ((reserved || performance.now() < suppressUntil) && event.target instanceof Node && stage.contains(event.target)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    const scan = () => {
      for (const frame of frames.keys()) if (!stage.contains(frame)) { cancel(); frames.delete(frame); }
      for (const frame of stage.querySelectorAll("iframe")) if (!frames.has(frame)) configure(frame, true);
    };
    const load = (event: Event) => {
      if (event.target instanceof HTMLIFrameElement && stage.contains(event.target)) { cancel(); configure(event.target, true); }
    };
    const previousTouchAction = stage.style.touchAction;
    stage.style.touchAction = "none"; scan();
    const observer = new MutationObserver(scan);
    observer.observe(stage, { childList: true, subtree: true });
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { for (const frame of frames.keys()) configure(frame, true); }) : null;
    resizeObserver?.observe(stage);
    for (const name of ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const) host.addEventListener(name, pointer, { capture: true, passive: false });
    host.addEventListener("message", receive); host.addEventListener("click", click, true);
    stage.ownerDocument.addEventListener("visibilitychange", visibility);
    host.addEventListener("pagehide", cancel); host.addEventListener("resize", cancel); host.addEventListener("blur", cancel);
    stage.addEventListener("load", load, true);
    return () => {
      cancel(); observer.disconnect(); resizeObserver?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      for (const name of ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const) host.removeEventListener(name, pointer, true);
      host.removeEventListener("message", receive); host.removeEventListener("click", click, true);
      stage.ownerDocument.removeEventListener("visibilitychange", visibility);
      host.removeEventListener("pagehide", cancel); host.removeEventListener("resize", cancel); host.removeEventListener("blur", cancel); stage.removeEventListener("load", load, true);
      for (const frame of frames.keys()) configure(frame, false);
      stage.style.touchAction = previousTouchAction;
    };
  }, [enabled, gestureKey, stageRef, palmThreshold]);
}
