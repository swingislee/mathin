"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { boardBus, type BoardBus } from "./bus";
import { BoardObjectLayer } from "./BoardObjectLayer";
import { createShapeFromDrag } from "./geometry";
import { InstrumentLayer } from "./InstrumentLayer";
import { colorVar, drawItem, hitStrokeId, newStrokeId, renderAll, resolveColor } from "./strokes";
import { useWhiteboardStore, type WhiteboardStore } from "./store";
import { COLOR_TOKENS, isStrokeItem, type ShapeItem, type StrokeItem, type Tool } from "./types";

/** S/M/L 碎擦宽度（相对逻辑画布宽），沿旧版手感微调。 */
const ERASER_NORM: Partial<Record<Tool, number>> = { eraserS: 0.012, eraserM: 0.025, eraserL: 0.05 };
const STROKE_ERASER_THRESHOLD_PX = 12;
const CURSOR_STALE_MS = 4000;

interface RemoteCursor {
  name: string;
  x: number;
  y: number;
  at: number;
}

/** 双层笔迹画布 + SVG 对象/尺规层。所有持久内容继续使用 0–1 归一化坐标。 */
export function CanvasSurface({
  editable,
  store = useWhiteboardStore,
  bus = boardBus,
  strokeWidthBasis,
}: {
  editable: boolean;
  store?: WhiteboardStore;
  bus?: BoardBus;
  /** 课堂场景传统一参照宽度，让同屏两块板书的画笔粗细一致。 */
  strokeWidthBasis?: number;
}) {
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
  const remotePendingRef = useRef<Map<string, StrokeItem>>(new Map());
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({});
  const [shapePreview, setShapePreview] = useState<ShapeItem | null>(null);

  const items = useStore(store, (state) => state.items);
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
    if (local && local.mode === "ink") drawItem(ctx, local, w, h, resolveColor(draft, local.color), basisW());
    for (const pending of remotePendingRef.current.values()) {
      if (pending.mode === "ink") drawItem(ctx, pending, w, h, resolveColor(draft, pending.color), basisW());
    }
  }, [basisW]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resize = () => {
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      const dpr = window.devicePixelRatio || 1;
      dimsRef.current = { w, h };
      setCanvasSize({ width: w, height: h });
      for (const canvas of [baseRef.current, draftRef.current]) {
        if (!canvas) continue;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      redrawBase();
      redrawDraft();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [redrawBase, redrawDraft]);

  useEffect(() => {
    redrawBase();
    redrawDraft();
  }, [strokeWidthBasis, redrawBase, redrawDraft]);

  useEffect(() => {
    for (const item of items) if (isStrokeItem(item)) remotePendingRef.current.delete(item.id);
    redrawBase();
    redrawDraft();
  }, [items, redrawBase, redrawDraft]);

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
      const pending = remotePendingRef.current;
      if (chunk.done) {
        pending.delete(chunk.id);
        redrawDraft();
        return;
      }
      if (store.getState().items.some((item) => item.id === chunk.id)) return;
      const existing = pending.get(chunk.id);
      if (existing) existing.points.push(...chunk.points);
      else pending.set(chunk.id, { id: chunk.id, mode: chunk.mode, color: chunk.color, wNorm: chunk.wNorm, points: [...chunk.points] });
      redrawDraft();
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
    if (!draft || !base || !editable || tool === "pointer") return;
    const baseCtx = base.getContext("2d");
    if (!baseCtx) return;
    const actions = store.getState();
    let capturedPointerId: number | null = null;
    let gestureStart: [number, number] | null = null;
    let gestureEnd: [number, number] | null = null;

    const toPoint = (event: PointerEvent): [number, number] => {
      const rect = draft.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const toNorm = (event: PointerEvent): [number, number] => {
      const [x, y] = toPoint(event);
      const { w, h } = dimsRef.current;
      return [x / w, y / h];
    };
    const eraseHit = (x: number, y: number) => {
      const { w, h } = dimsRef.current;
      const id = hitStrokeId(store.getState().items, x, y, w, h, STROKE_ERASER_THRESHOLD_PX, basisW());
      if (id) actions.eraseLine(id);
    };

    const down = (event: PointerEvent) => {
      const [x, y] = toPoint(event);
      const norm = toNorm(event);
      gestureStart = norm;
      gestureEnd = norm;
      draft.setPointerCapture(event.pointerId);
      capturedPointerId = event.pointerId;
      if (tool === "shape") {
        setShapePreview(createShapeFromDrag("shape-preview", shapeKind, norm, norm, color, fill, sizeNorm, dimsRef.current.h / dimsRef.current.w));
        return;
      }
      if (tool === "strokeEraser") {
        eraseHit(x, y);
        return;
      }
      const { w, h } = dimsRef.current;
      const erase = tool.startsWith("eraser");
      const stroke: StrokeItem = {
        id: newStrokeId(), mode: erase ? "erase" : "ink", color,
        wNorm: erase ? ERASER_NORM[tool] ?? 0.02 : sizeNorm,
        points: [[x / w, y / h]],
      };
      strokeRef.current = stroke;
      if (stroke.mode === "ink") bus.emit("local-progress-start", stroke);
    };

    const move = (event: PointerEvent) => {
      const [x, y] = toPoint(event);
      const { w, h } = dimsRef.current;
      const norm: [number, number] = [x / w, y / h];
      bus.emit("local-cursor", { x: norm[0], y: norm[1] });
      gestureEnd = norm;
      if (tool === "shape" && gestureStart) {
        setShapePreview(createShapeFromDrag("shape-preview", shapeKind, gestureStart, norm, color, fill, sizeNorm, dimsRef.current.h / dimsRef.current.w));
        return;
      }
      if (tool.startsWith("eraser")) setCursor([x, y]);
      if (tool === "strokeEraser") {
        if (event.buttons & 1) eraseHit(x, y);
        return;
      }
      const stroke = strokeRef.current;
      if (!stroke) return;
      const prev = stroke.points[stroke.points.length - 1];
      stroke.points.push(norm);
      if (stroke.mode === "ink") redrawDraft();
      else drawItem(baseCtx, { ...stroke, points: [prev, norm] }, w, h, "#000", basisW());
    };

    const releaseCapture = () => {
      if (capturedPointerId === null) return;
      try {
        if (draft.hasPointerCapture(capturedPointerId)) draft.releasePointerCapture(capturedPointerId);
      } catch {
        // 节点卸载时 capture 已隐式释放。
      }
      capturedPointerId = null;
    };

    const finish = () => {
      releaseCapture();
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
      if (stroke.mode === "ink") bus.emit("local-progress-end", { id: stroke.id });
      store.getState().commitItem(stroke);
    };

    const leave = () => setCursor(null);
    draft.addEventListener("pointerdown", down);
    draft.addEventListener("pointermove", move);
    draft.addEventListener("pointerleave", leave);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      draft.removeEventListener("pointerdown", down);
      draft.removeEventListener("pointermove", move);
      draft.removeEventListener("pointerleave", leave);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [editable, tool, color, fill, sizeNorm, shapeKind, redrawDraft, store, bus, basisW]);

  const interactive = editable && tool !== "pointer";
  const cursorStyle = !interactive ? "default" : tool.startsWith("eraser") ? "none" : "crosshair";
  const eraserSize = (ERASER_NORM[tool] ?? 0) * (strokeWidthBasis && strokeWidthBasis > 0 ? strokeWidthBasis : canvasSize.width);

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0">
      <canvas ref={baseRef} className="absolute inset-0 h-full w-full touch-none" style={{ pointerEvents: "none" }} />
      <BoardObjectLayer store={store} editable={editable} width={canvasSize.width} height={canvasSize.height} preview={shapePreview} />
      <canvas
        ref={draftRef}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ pointerEvents: interactive ? "auto" : "none", cursor: cursorStyle }}
      />
      <InstrumentLayer store={store} editable={editable} width={canvasSize.width} height={canvasSize.height} />
      {Object.entries(remoteCursors).map(([key, value]) => (
        <div key={key} aria-hidden className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2" style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }}>
          <span className="block size-2.5 rounded-full border border-paper shadow" style={{ background: colorVar(COLOR_TOKENS[Math.abs([...key].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % COLOR_TOKENS.length]) }} />
          <span className="mt-1 block max-w-28 truncate rounded-full bg-ink/80 px-1.5 py-0.5 text-[10px] leading-none text-paper">{value.name}</span>
        </div>
      ))}
      {interactive && tool.startsWith("eraser") && cursor && eraserSize > 0 ? (
        <div aria-hidden className="pointer-events-none absolute box-border border border-muted" style={{ left: cursor[0] - eraserSize / 2, top: cursor[1] - eraserSize / 2, width: eraserSize, height: eraserSize }} />
      ) : null}
    </div>
  );
}
