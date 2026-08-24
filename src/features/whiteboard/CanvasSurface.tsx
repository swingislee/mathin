"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import { BoardInputSink, type InputPoint } from "./board-input-sink";
import { boardBus, type BoardBus } from "./bus";
import { BoardObjectLayer } from "./BoardObjectLayer";
import { createShapeFromDrag } from "./geometry";
import { InstrumentLayer } from "./InstrumentLayer";
import { colorVar, drawItem, hitStrokeId, newStrokeId, renderAll, resolveColor } from "./strokes";
import { useWhiteboardStore, type WhiteboardStore } from "./store";
import { COLOR_TOKENS, isStrokeItem, type ShapeItem, type StrokeItem, type Tool } from "./types";
import { ProgressStreamAssembler } from "./progress-stream";
import { classroomPixelBudget, type WhiteboardRenderProfile } from "./render-profile";

/** S/M/L 碎擦宽度（相对逻辑画布宽），沿旧版手感微调。 */
const ERASER_NORM: Partial<Record<Tool, number>> = { eraserS: 0.012, eraserM: 0.025, eraserL: 0.05 };
const STROKE_ERASER_THRESHOLD_PX = 12;
const CURSOR_STALE_MS = 4000;
const DRAFT_TAIL_OVERLAP_POINTS = 12;

interface RemoteCursor {
  name: string;
  x: number;
  y: number;
  at: number;
}

export type CanvasSurfaceInputMode = "smart" | "interaction-lock" | "ink-lock";
export type NormalizedInputPoint = [number, number];

/** Smart routing writes through this port while both Canvas layers stay render-only. */
export interface CanvasSurfaceInputPort {
  begin(pointerId: number, origin: NormalizedInputPoint): boolean;
  append(pointerId: number, points: readonly NormalizedInputPoint[]): boolean;
  finish(pointerId: number, points?: readonly NormalizedInputPoint[]): boolean;
  cancel(pointerId: number): boolean;
}

/** 双层笔迹画布 + SVG 对象/尺规层。所有持久内容继续使用 0–1 归一化坐标。 */
export function CanvasSurface({
  editable,
  store = useWhiteboardStore,
  bus = boardBus,
  strokeWidthBasis,
  renderProfile = "default",
  inputMode = "ink-lock",
  onInputPort,
}: {
  editable: boolean;
  store?: WhiteboardStore;
  bus?: BoardBus;
  /** 课堂场景传统一参照宽度，让同屏两块板书的画笔粗细一致。 */
  strokeWidthBasis?: number;
  /** 课堂 profile 启用 DPR、单 Canvas 与全课堂总像素三重护栏。 */
  renderProfile?: WhiteboardRenderProfile;
  /** Main-stage ownership. Existing callers retain direct ink ownership by default. */
  inputMode?: CanvasSurfaceInputMode;
  onInputPort?: (port: CanvasSurfaceInputPort | null) => void;
}) {
  const surfaceId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const draftRef = useRef<HTMLCanvasElement | null>(null);
  const dimsRef = useRef({ w: 1, h: 1 });
  const basisRef = useRef(strokeWidthBasis);
  useEffect(() => {
    basisRef.current = strokeWidthBasis;
  }, [strokeWidthBasis]);
  const basisW = useCallback(() => (basisRef.current && basisRef.current > 0 ? basisRef.current : dimsRef.current.w), []);
  const strokeRef = useRef<StrokeItem | null>(null);
  const draftDrawnPointsRef = useRef(0);
  const remoteProgressRef = useRef(new ProgressStreamAssembler());
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({});
  const [shapePreview, setShapePreview] = useState<ShapeItem | null>(null);

  const renderMutation = useStore(store, (state) => state.renderMutation);
  const tool = useStore(store, (state) => state.tool);
  const color = useStore(store, (state) => state.color);
  const fill = useStore(store, (state) => state.fill);
  const sizeNorm = useStore(store, (state) => state.sizeNorm);
  const shapeKind = useStore(store, (state) => state.shapeKind);
  const selectedIds = useStore(store, (state) => state.selectedIds);


  const redrawBase = useCallback(() => {
    const base = baseRef.current;
    const ctx = base?.getContext("2d");
    if (!base || !ctx) return;
    renderAll(ctx, store.getState().items, dimsRef.current.w, dimsRef.current.h, base, basisW());
  }, [store, basisW]);

  const redrawDraft = useCallback(() => {
    const draft = draftRef.current;
    const ctx = draft?.getContext("2d");
    if (!draft || !ctx) return;
    const { w, h } = dimsRef.current;
    ctx.clearRect(0, 0, w, h);
    const local = strokeRef.current;
    if (local && local.mode === "ink") {
      drawItem(ctx, local, w, h, resolveColor(draft, local.color), basisW());
      draftDrawnPointsRef.current = local.points.length;
    } else {
      draftDrawnPointsRef.current = 0;
    }
    for (const pending of remoteProgressRef.current.strokes()) {
      if (pending.mode === "ink") drawItem(ctx, pending, w, h, resolveColor(draft, pending.color), basisW());
    }
  }, [basisW]);

  const drawLocalDraftTail = useCallback(() => {
    const draft = draftRef.current;
    const ctx = draft?.getContext("2d");
    const stroke = strokeRef.current;
    if (!draft || !ctx || !stroke || stroke.mode !== "ink") return;
    const drawn = draftDrawnPointsRef.current;
    if (stroke.points.length <= drawn) return;
    const from = Math.max(0, drawn - DRAFT_TAIL_OVERLAP_POINTS);
    const tail = { ...stroke, points: stroke.points.slice(from) };
    drawItem(ctx, tail, dimsRef.current.w, dimsRef.current.h, resolveColor(draft, stroke.color), basisW());
    draftDrawnPointsRef.current = stroke.points.length;
  }, [basisW]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const applyDpr = (dpr: number) => {
      const { w, h } = dimsRef.current;
      let backingPixels = 0;
      for (const canvas of [baseRef.current, draftRef.current]) {
        if (!canvas) continue;
        canvas.width = Math.max(1, Math.floor(w * dpr));
        canvas.height = Math.max(1, Math.floor(h * dpr));
        backingPixels += canvas.width * canvas.height;
        canvas.getContext("2d")?.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
      }
      container.dataset.effectiveDpr = dpr.toFixed(3);
      container.dataset.backingPixels = String(backingPixels);
      redrawBase();
      redrawDraft();
    };
    const unregister = renderProfile === "classroom"
      ? classroomPixelBudget.register(surfaceId, applyDpr)
      : null;
    const resize = () => {
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      dimsRef.current = { w, h };
      setCanvasSize((previous) => previous.width === w && previous.height === h ? previous : { width: w, height: h });
      const deviceDpr = window.devicePixelRatio || 1;
      if (renderProfile === "classroom") {
        classroomPixelBudget.update(surfaceId, { width: w, height: h, deviceDpr, canvasCount: 2 });
      } else {
        applyDpr(deviceDpr);
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      unregister?.();
    };
  }, [redrawBase, redrawDraft, renderProfile, surfaceId]);

  useEffect(() => {
    redrawBase();
    redrawDraft();
  }, [strokeWidthBasis, redrawBase, redrawDraft]);

  useEffect(() => {
    const base = baseRef.current;
    const ctx = base?.getContext("2d");
    if (renderMutation.kind === "append" && base && ctx) {
      const { w, h } = dimsRef.current;
      for (const item of renderMutation.items) {
        if (!isStrokeItem(item)) continue;
        remoteProgressRef.current.finish(item.id);
        drawItem(ctx, item, w, h, item.mode === "erase" ? "#000" : resolveColor(base, item.color), basisW());
      }
    } else {
      redrawBase();
    }
    redrawDraft();
  }, [renderMutation, redrawBase, redrawDraft, basisW]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      redrawBase();
      redrawDraft();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { redrawBase(); redrawDraft(); };
    media.addEventListener("change", onChange);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", onChange);
    };
  }, [redrawBase, redrawDraft]);

  useEffect(() => {
    const offProgress = bus.on("remote-progress", (chunk) => {
      const committed = store.getState().items.some((item) => item.id === chunk.id);
      if (remoteProgressRef.current.ingest(chunk, committed)) redrawDraft();
    });
    const offCursor = bus.on("remote-cursor", (payload) => {
      setRemoteCursors((prev) => ({ ...prev, [payload.key]: { name: payload.name, x: payload.x, y: payload.y, at: Date.now() } }));
    });
    const prune = setInterval(() => {
      setRemoteCursors((prev) => {
        const now = Date.now();
        const alive = Object.entries(prev).filter(([, value]) => now - value.at < CURSOR_STALE_MS);
        return alive.length === Object.keys(prev).length ? prev : Object.fromEntries(alive);
      });
    }, 2000);
    return () => { offProgress(); offCursor(); clearInterval(prune); };
  }, [redrawDraft, bus, store]);

  useEffect(() => {
    if (!editable || selectedIds.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        store.getState().removeItems(store.getState().selectedIds);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        store.getState().duplicateSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, selectedIds.length, store]);

  useEffect(() => {
    const draft = draftRef.current;
    const base = baseRef.current;
    const externalRouting = inputMode === "smart" && tool === "pen";
    if (!draft || !base || !editable || inputMode === "interaction-lock" || tool === "pointer") {
      onInputPort?.(null);
      return;
    }
    const baseCtx = base.getContext("2d");
    if (!baseCtx) return;
    const actions = store.getState();
    let capturedPointerId: number | null = null;
    let gestureStart: [number, number] | null = null;
    let gestureEnd: [number, number] | null = null;

    const toPoint = (event: PointerEvent): InputPoint => {
      const rect = draft.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const eventPoints = (event: PointerEvent): InputPoint[] => {
      const coalesced = event.getCoalescedEvents?.() ?? [];
      const points = (coalesced.length ? coalesced : [event]).map(toPoint);
      const current = toPoint(event);
      const last = points[points.length - 1];
      if (!last || last[0] !== current[0] || last[1] !== current[1]) points.push(current);
      return points;
    };
    const toNorm = ([x, y]: InputPoint): [number, number] => {
      const { w, h } = dimsRef.current;
      return [x / w, y / h];
    };
    const eraseHit = (x: number, y: number) => {
      const { w, h } = dimsRef.current;
      const id = hitStrokeId(store.getState().items, x, y, w, h, STROKE_ERASER_THRESHOLD_PX, basisW());
      if (id) actions.eraseLine(id);
    };

    const sink = new BoardInputSink((points) => {
      const norms = points.map(toNorm);
      const lastPoint = points[points.length - 1];
      const lastNorm = norms[norms.length - 1];
      gestureEnd = lastNorm;
      if (tool === "shape" && gestureStart) {
        setShapePreview(createShapeFromDrag("shape-preview", shapeKind, gestureStart, lastNorm, color, fill, sizeNorm, dimsRef.current.h / dimsRef.current.w));
        return;
      }
      if (tool.startsWith("eraser")) setCursor(lastPoint);
      if (tool === "strokeEraser") {
        for (const [x, y] of points) eraseHit(x, y);
        return;
      }
      const stroke = strokeRef.current;
      if (!stroke) return;
      const { w, h } = dimsRef.current;
      for (const norm of norms) {
        const previous = stroke.points[stroke.points.length - 1];
        stroke.points.push(norm);
        if (stroke.mode === "erase") {
          drawItem(baseCtx, { ...stroke, points: [previous, norm] }, w, h, "#000", basisW());
        }
      }
      if (stroke.mode === "ink") drawLocalDraftTail();
    });

    const beginGesture = (pointerId: number, point: InputPoint) => {
      if (!sink.begin(pointerId, point)) return false;
      const [x, y] = point;
      const norm = toNorm(point);
      gestureStart = norm;
      gestureEnd = norm;
      if (tool === "shape") {
        setShapePreview(createShapeFromDrag("shape-preview", shapeKind, norm, norm, color, fill, sizeNorm, dimsRef.current.h / dimsRef.current.w));
        return true;
      }
      if (tool === "strokeEraser") {
        eraseHit(x, y);
        return true;
      }
      const { w, h } = dimsRef.current;
      const erase = tool.startsWith("eraser");
      const stroke: StrokeItem = {
        id: newStrokeId(), mode: erase ? "erase" : "ink", color,
        wNorm: erase ? ERASER_NORM[tool] ?? 0.02 : sizeNorm,
        points: [[x / w, y / h]],
      };
      strokeRef.current = stroke;
      draftDrawnPointsRef.current = 0;
      if (stroke.mode === "ink") bus.emit("local-progress-start", stroke);
      return true;
    };

    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      if (!beginGesture(event.pointerId, toPoint(event))) return;
      event.preventDefault();
      capturedPointerId = event.pointerId;
      try {
        draft.setPointerCapture(event.pointerId);
      } catch {
        // Some synthetic/test pointer sources do not expose pointer capture.
      }
    };

    const move = (event: PointerEvent) => {
      const point = toPoint(event);
      const norm = toNorm(point);
      bus.emit("local-cursor", { x: norm[0], y: norm[1] });
      if (tool.startsWith("eraser")) setCursor(point);
      sink.push(event.pointerId, eventPoints(event));
    };

    const releaseCapture = (pointerId: number) => {
      if (capturedPointerId !== pointerId) return;
      capturedPointerId = null;
      try {
        if (draft.hasPointerCapture(pointerId)) draft.releasePointerCapture(pointerId);
      } catch {
        // 节点卸载时 capture 已隐式释放。
      }
    };

    const commitGesture = () => {
      if (tool === "shape") {
        const start = gestureStart;
        const end = gestureEnd;
        const preview = start && end ? createShapeFromDrag(newStrokeId(), shapeKind, start, end, color, fill, sizeNorm, dimsRef.current.h / dimsRef.current.w) : null;
        gestureStart = null;
        gestureEnd = null;
        setShapePreview(null);
        if (preview && Math.hypot(end![0] - start![0], end![1] - start![1]) > 0.006) store.getState().commitItem(preview);
        return;
      }
      const stroke = strokeRef.current;
      if (!stroke) return;
      strokeRef.current = null;
      draftDrawnPointsRef.current = 0;
      if (stroke.mode === "ink") bus.emit("local-progress-end", { id: stroke.id });
      store.getState().commitItem(stroke);
    };

    const discardGesture = () => {
      const stroke = strokeRef.current;
      strokeRef.current = null;
      gestureStart = null;
      gestureEnd = null;
      draftDrawnPointsRef.current = 0;
      setShapePreview(null);
      if (stroke?.mode === "ink") bus.emit("local-progress-end", { id: stroke.id });
      redrawBase();
      redrawDraft();
    };

    const finish = (event: PointerEvent) => {
      if (!sink.finish(event.pointerId, eventPoints(event))) return;
      releaseCapture(event.pointerId);
      commitGesture();
    };
    const finishLostCapture = (event: PointerEvent) => {
      if (!sink.finish(event.pointerId)) return;
      capturedPointerId = null;
      commitGesture();
    };
    const drain = () => {
      const pointerId = sink.drain();
      if (pointerId === null) return;
      releaseCapture(pointerId);
      commitGesture();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") drain();
    };

    const fromNormalized = ([x, y]: NormalizedInputPoint): InputPoint => [
      x * dimsRef.current.w,
      y * dimsRef.current.h,
    ];
    const port: CanvasSurfaceInputPort = {
      begin: (pointerId, origin) => beginGesture(pointerId, fromNormalized(origin)),
      append: (pointerId, points) => sink.push(pointerId, points.map(fromNormalized)),
      finish: (pointerId, points = []) => {
        if (!sink.finish(pointerId, points.map(fromNormalized))) return false;
        commitGesture();
        return true;
      },
      cancel: (pointerId) => {
        if (!sink.cancel(pointerId)) return false;
        discardGesture();
        return true;
      },
    };

    if (externalRouting) onInputPort?.(port);

    const leave = () => setCursor(null);
    if (!externalRouting) {
      draft.addEventListener("pointerdown", down);
      draft.addEventListener("pointermove", move);
      draft.addEventListener("pointerleave", leave);
      draft.addEventListener("lostpointercapture", finishLostCapture);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
      window.addEventListener("blur", drain);
      window.addEventListener("pagehide", drain);
      document.addEventListener("visibilitychange", visibility);
    }
    return () => {
      if (externalRouting) {
        const pointerId = sink.pointerId;
        if (pointerId !== null) port.cancel(pointerId);
        onInputPort?.(null);
      } else {
        drain();
      }
      sink.dispose();
      draft.removeEventListener("pointerdown", down);
      draft.removeEventListener("pointermove", move);
      draft.removeEventListener("pointerleave", leave);
      draft.removeEventListener("lostpointercapture", finishLostCapture);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", drain);
      window.removeEventListener("pagehide", drain);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [editable, tool, color, fill, sizeNorm, shapeKind, store, bus, basisW, drawLocalDraftTail, inputMode, onInputPort, redrawBase, redrawDraft]);

  const externalPenRouting = inputMode === "smart" && tool === "pen";
  const canvasInteractive = editable
    && inputMode !== "interaction-lock"
    && tool !== "pointer"
    && !externalPenRouting;
  const boardLayersEditable = editable && inputMode !== "interaction-lock" && !externalPenRouting;
  const cursorStyle = !canvasInteractive ? "default" : tool.startsWith("eraser") ? "none" : "crosshair";
  const eraserSize = (ERASER_NORM[tool] ?? 0) * (strokeWidthBasis && strokeWidthBasis > 0 ? strokeWidthBasis : canvasSize.width);

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0" data-input-mode={inputMode} data-render-profile={renderProfile}>
      <canvas ref={baseRef} className="absolute inset-0 h-full w-full touch-none" style={{ pointerEvents: "none" }} />
      <BoardObjectLayer store={store} editable={boardLayersEditable} width={canvasSize.width} height={canvasSize.height} preview={shapePreview} />
      <canvas
        ref={draftRef}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ pointerEvents: canvasInteractive ? "auto" : "none", cursor: cursorStyle }}
      />
      <InstrumentLayer store={store} editable={boardLayersEditable} width={canvasSize.width} height={canvasSize.height} />
      {Object.entries(remoteCursors).map(([key, value]) => (
        <div key={key} aria-hidden className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2" style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }}>
          <span className="block size-2.5 rounded-full border border-paper shadow" style={{ background: colorVar(COLOR_TOKENS[Math.abs([...key].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % COLOR_TOKENS.length]) }} />
          <span className="mt-1 block max-w-28 truncate rounded-full bg-ink/80 px-1.5 py-0.5 text-[10px] leading-none text-paper">{value.name}</span>
        </div>
      ))}
      {canvasInteractive && tool.startsWith("eraser") && cursor && eraserSize > 0 ? (
        <div aria-hidden className="pointer-events-none absolute box-border border border-muted" style={{ left: cursor[0] - eraserSize / 2, top: cursor[1] - eraserSize / 2, width: eraserSize, height: eraserSize }} />
      ) : null}
    </div>
  );
}
