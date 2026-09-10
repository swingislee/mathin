"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { newId } from "@/lib/uuid";
import {
  CLASSROOM_VIEWPORT_PROTOCOL, beginViewportGesture, moveViewportGesture,
  type ViewportGestureStart, type ViewportTouch,
} from "./classroom-viewport";

/** 在窗口和已登记的 opaque iframe 上收集触点；第二指取消草稿后接管，单指与笔沿用原路由。 */
export function useClassroomViewportGestures({ enabled, stageRef, gestureKey, percent, min, max, onChange, onEnd, onCancelInk }: {
  enabled: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  gestureKey: string;
  percent: number;
  min: number;
  max: number;
  onChange: (percent: number, centerY: number) => void;
  onEnd: () => void;
  onCancelInk: (pointerId: number) => void;
}) {
  const current = useRef({ percent, min, max, onChange, onEnd, onCancelInk });
  useLayoutEffect(() => { current.current = { percent, min, max, onChange, onEnd, onCancelInk }; });
  useEffect(() => {
    const stage = stageRef.current;
    if (!enabled || !stage) return;
    const viewport = stage.parentElement!;
    const host = stage.ownerDocument.defaultView!;
    const touches = new Map<string, ViewportTouch & { target?: EventTarget | null; pointerId: number }>();
    const frames = new Map<HTMLIFrameElement, string>();
    let gesture: ViewportGestureStart | null = null;
    let pair: string[] = [];
    let reserved = false;
    let cancelling = false;
    let suppressUntil = 0;
    let raf = 0;
    const configure = (frame: HTMLIFrameElement, active: boolean) => {
      let token = frames.get(frame);
      if (!token) { token = newId(); frames.set(frame, token); }
      frame.contentWindow?.postMessage({ protocol: CLASSROOM_VIEWPORT_PROTOCOL, type: "configure", enabled: active, token }, "*");
    };
    const reserve = (active: boolean) => {
      reserved = active;
      for (const [frame, token] of frames) frame.contentWindow?.postMessage({ protocol: CLASSROOM_VIEWPORT_PROTOCOL, type: "reserve", active, token }, "*");
    };
    const flush = () => {
      raf = 0;
      if (!gesture || pair.some((key) => !touches.has(key))) return;
      const rect = viewport.getBoundingClientRect();
      const result = moveViewportGesture(gesture, pair.map((key) => touches.get(key)!), rect, current.current.min, current.current.max);
      current.current.onChange(result.percent, result.centerY);
    };
    const start = () => {
      if (gesture || reserved || touches.size < 2) return;
      pair = [...touches.keys()].slice(0, 2);
      gesture = beginViewportGesture(pair.map((key) => touches.get(key)!), current.current.percent, stage.getBoundingClientRect());
      reserve(true);
      cancelling = true;
      for (const [key, point] of touches) {
        if (!key.startsWith("host:")) continue;
        current.current.onCancelInk(point.pointerId);
        point.target?.dispatchEvent(new PointerEvent("pointercancel", { pointerId: point.pointerId, pointerType: "touch", bubbles: true }));
      }
      cancelling = false;
    };
    const end = (key: string) => {
      if (gesture && pair.includes(key)) {
        if (raf) { cancelAnimationFrame(raf); flush(); }
        gesture = null;
        suppressUntil = performance.now() + 600;
        current.current.onEnd();
      }
      touches.delete(key);
      if (touches.size === 0) reserve(false);
    };
    const pointer = (event: PointerEvent) => {
      if (cancelling || event.pointerType !== "touch") return;
      const key = `host:${event.pointerId}`;
      if (event.type === "pointerdown") {
        if (!(event.target instanceof Node) || !stage.contains(event.target) || touches.size >= 10) return;
        touches.set(key, { x: event.screenX, y: event.screenY, clientY: event.clientY, target: event.target, pointerId: event.pointerId });
        start();
      } else if (touches.has(key)) {
        const point = touches.get(key)!;
        touches.set(key, { ...point, x: event.screenX, y: event.screenY, clientY: event.clientY });
        if (event.type === "pointermove" && gesture && !raf) raf = requestAnimationFrame(flush);
      } else return;
      const owned = reserved;
      if (event.type === "pointerup" || event.type === "pointercancel") end(key);
      if (owned) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.protocol !== CLASSROOM_VIEWPORT_PROTOCOL) return;
      const frame = [...frames.keys()].find((candidate) => candidate.contentWindow === event.source);
      if (!frame) return;
      if (data.type === "hello") { configure(frame, true); return; }
      if (data.token === frames.get(frame) && data.type === "cancel-all") { cancel(); return; }
      if (data.token !== frames.get(frame) || data.type !== "touch" || !Number.isSafeInteger(data.id)
        || !["down", "move", "up", "cancel"].includes(data.phase)
        || ![data.x, data.y, data.ny].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e6)
        || data.ny < 0 || data.ny > 1) return;
      const key = `${data.token}:${data.id}`;
      if (data.phase === "down" && touches.size < 10) {
        const rect = frame.getBoundingClientRect();
        touches.set(key, { x: data.x, y: data.y, clientY: rect.top + data.ny * rect.height, pointerId: data.id });
        start();
      } else if (touches.has(key)) {
        touches.set(key, { ...touches.get(key)!, x: data.x, y: data.y });
        if (data.phase === "move" && gesture && !raf) raf = requestAnimationFrame(flush);
        if (data.phase === "up" || data.phase === "cancel") end(key);
      }
    };
    const cancel = () => {
      if (gesture) current.current.onEnd();
      gesture = null; touches.clear(); reserve(false);
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
    stage.style.touchAction = "none";
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(stage, { childList: true, subtree: true });
    for (const name of ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const) host.addEventListener(name, pointer, { capture: true, passive: false });
    host.addEventListener("message", receive);
    stage.ownerDocument.addEventListener("visibilitychange", visibility);
    host.addEventListener("pagehide", cancel);
    host.addEventListener("resize", cancel);
    host.addEventListener("click", click, true);
    stage.addEventListener("load", load, true);
    return () => {
      cancel(); observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
      for (const name of ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const) host.removeEventListener(name, pointer, true);
      host.removeEventListener("message", receive); host.removeEventListener("click", click, true);
      stage.ownerDocument.removeEventListener("visibilitychange", visibility);
      host.removeEventListener("pagehide", cancel); host.removeEventListener("resize", cancel);
      stage.removeEventListener("load", load, true);
      for (const frame of frames.keys()) configure(frame, false);
      stage.style.touchAction = previousTouchAction;
    };
  }, [enabled, gestureKey, stageRef]);
}
