"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawItem, hitStrokeId, newStrokeId, renderAll, resolveColor } from "./strokes";
import { useWhiteboardStore } from "./store";
import type { StrokeItem, Tool } from "./types";

/** S/M/L 碎擦宽度（相对逻辑画布宽），沿旧版手感微调。 */
const ERASER_NORM: Partial<Record<Tool, number>> = { eraserS: 0.012, eraserM: 0.025, eraserL: 0.05 };
const STROKE_ERASER_THRESHOLD_PX = 12;

/**
 * 双层画布：base 落定笔迹（由 store.items 全量重放），draft 只画进行中的笔迹。
 * 组件自身无笔迹状态（08-§7：canvas 无状态化，切换/卸载无保存竞态）。
 */
export function CanvasSurface({ editable }: { editable: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const draftRef = useRef<HTMLCanvasElement | null>(null);
  const dimsRef = useRef({ w: 1, h: 1 });
  const strokeRef = useRef<StrokeItem | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [cssWidth, setCssWidth] = useState(0);

  const items = useWhiteboardStore((state) => state.items);
  const tool = useWhiteboardStore((state) => state.tool);
  const color = useWhiteboardStore((state) => state.color);
  const sizeNorm = useWhiteboardStore((state) => state.sizeNorm);

  const redrawBase = useCallback(() => {
    const base = baseRef.current;
    const ctx = base?.getContext("2d");
    if (!base || !ctx) return;
    renderAll(ctx, useWhiteboardStore.getState().items, dimsRef.current.w, dimsRef.current.h, base);
  }, []);

  const clearDraft = useCallback(() => {
    const draft = draftRef.current;
    const ctx = draft?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, dimsRef.current.w, dimsRef.current.h);
  }, []);

  /* 尺寸自适应：backing store 用设备像素，绘制坐标一律 CSS 像素（08-§3.2 坐标契约）。 */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resize = () => {
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      const dpr = window.devicePixelRatio || 1;
      dimsRef.current = { w, h };
      setCssWidth(w);
      for (const canvas of [baseRef.current, draftRef.current]) {
        if (!canvas) continue;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      redrawBase();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [redrawBase]);

  /* 笔迹变更（提交/撤销/清空/远端到达）→ 全量重放。 */
  useEffect(() => {
    redrawBase();
    clearDraft();
  }, [items, redrawBase, clearDraft]);

  /* 主题切换时 token 色值变化，需重放一次。 */
  useEffect(() => {
    const observer = new MutationObserver(redrawBase);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", redrawBase);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", redrawBase);
    };
  }, [redrawBase]);

  /* 指针逻辑 */
  useEffect(() => {
    const draft = draftRef.current;
    const base = baseRef.current;
    if (!draft || !base || !editable || tool === "pointer") return;
    const draftCtx = draft.getContext("2d");
    const baseCtx = base.getContext("2d");
    if (!draftCtx || !baseCtx) return;
    const store = useWhiteboardStore.getState();

    const toPoint = (event: PointerEvent): [number, number] => {
      const rect = draft.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };

    const eraseHit = (x: number, y: number) => {
      const { w, h } = dimsRef.current;
      const id = hitStrokeId(useWhiteboardStore.getState().items, x, y, w, h, STROKE_ERASER_THRESHOLD_PX);
      if (id) store.eraseLine(id);
    };

    const down = (event: PointerEvent) => {
      const [x, y] = toPoint(event);
      if (tool === "strokeEraser") {
        eraseHit(x, y);
        return;
      }
      const { w, h } = dimsRef.current;
      const erase = tool.startsWith("eraser");
      strokeRef.current = {
        id: newStrokeId(),
        mode: erase ? "erase" : "ink",
        color,
        wNorm: erase ? ERASER_NORM[tool] ?? 0.02 : sizeNorm,
        points: [[x / w, y / h]],
      };
      draft.setPointerCapture(event.pointerId);
    };

    const move = (event: PointerEvent) => {
      const [x, y] = toPoint(event);
      if (tool.startsWith("eraser")) setCursor([x, y]);
      if (tool === "strokeEraser") {
        if (event.buttons & 1) eraseHit(x, y);
        return;
      }
      const stroke = strokeRef.current;
      if (!stroke) return;
      const { w, h } = dimsRef.current;
      const prev = stroke.points[stroke.points.length - 1];
      stroke.points.push([x / w, y / h]);
      if (stroke.mode === "ink") {
        draftCtx.clearRect(0, 0, w, h);
        drawItem(draftCtx, stroke, w, h, resolveColor(draft, stroke.color));
      } else {
        // 碎擦：直接在 base 上增量挖除做即时反馈；提交后由全量重放收敛到同一结果。
        drawItem(baseCtx, { ...stroke, points: [prev, [x / w, y / h]] }, w, h, "#000");
      }
    };

    const finish = () => {
      const stroke = strokeRef.current;
      if (!stroke) return;
      strokeRef.current = null;
      clearDraft();
      useWhiteboardStore.getState().commitItem(stroke);
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
  }, [editable, tool, color, sizeNorm, clearDraft]);

  const interactive = editable && tool !== "pointer";
  const cursorStyle = !interactive ? "default" : tool.startsWith("eraser") ? "none" : "crosshair";
  const eraserSize = (ERASER_NORM[tool] ?? 0) * cssWidth;

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas ref={baseRef} className="absolute inset-0 h-full w-full touch-none" style={{ pointerEvents: "none" }} />
      <canvas
        ref={draftRef}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ pointerEvents: interactive ? "auto" : "none", cursor: cursorStyle }}
      />
      {interactive && tool.startsWith("eraser") && cursor && eraserSize > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute box-border border border-muted"
          style={{
            left: cursor[0] - eraserSize / 2,
            top: cursor[1] - eraserSize / 2,
            width: eraserSize,
            height: eraserSize,
          }}
        />
      )}
    </div>
  );
}
