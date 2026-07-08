"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { boardBus, type BoardBus } from "./bus";
import { colorVar, drawItem, hitStrokeId, newStrokeId, renderAll, resolveColor } from "./strokes";
import { useWhiteboardStore, type WhiteboardStore } from "./store";
import { COLOR_TOKENS, type StrokeItem, type Tool } from "./types";

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

/**
 * 双层画布：base 落定笔迹（由 store.items 全量重放），draft 画进行中的笔迹
 * （本地 + 远端 progress 流）。组件自身无笔迹状态（08-§7：canvas 无状态化）。
 * 坐标契约：一切读写坐标先除以容器 CSS 尺寸归一化；组件对容器纵横比无感知，
 * 独立白板 16:9、课堂主板书 4:3 都由父容器决定。
 * store/bus 可注入：默认全局单例（独立白板）；课堂主/副板书各传自己的实例。
 */
export function CanvasSurface({
  editable,
  store = useWhiteboardStore,
  bus = boardBus,
  strokeWidthBasis,
}: {
  editable: boolean;
  store?: WhiteboardStore;
  bus?: BoardBus;
  /** 线宽换算的参照宽度（像素）：不传则用画布自身宽度（独立白板默认行为）；
   *  课堂场景传入统一值（主板书宽度），让同屏两块板上的同一支笔粗细一致。 */
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
  // 稳定引用（只读 ref，不随 strokeWidthBasis 变化重建）：line-width 换算的参照宽度。
  const basisW = useCallback(() => (basisRef.current && basisRef.current > 0 ? basisRef.current : dimsRef.current.w), []);
  const strokeRef = useRef<StrokeItem | null>(null);
  const remotePendingRef = useRef<Map<string, StrokeItem>>(new Map());
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [cssWidth, setCssWidth] = useState(0);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({});

  const items = useStore(store, (state) => state.items);
  const tool = useStore(store, (state) => state.tool);
  const color = useStore(store, (state) => state.color);
  const sizeNorm = useStore(store, (state) => state.sizeNorm);

  const redrawBase = useCallback(() => {
    const base = baseRef.current;
    const ctx = base?.getContext("2d");
    if (!base || !ctx) return;
    renderAll(ctx, store.getState().items, dimsRef.current.w, dimsRef.current.h, base, basisW());
  }, [store, basisW]);

  /** draft = 本地进行中的墨迹 + 远端 progress 预览（碎擦不预览，见 08-§3.2）。 */
  const redrawDraft = useCallback(() => {
    const draft = draftRef.current;
    const ctx = draft?.getContext("2d");
    if (!draft || !ctx) return;
    const { w, h } = dimsRef.current;
    ctx.clearRect(0, 0, w, h);
    const local = strokeRef.current;
    if (local && local.mode === "ink") {
      drawItem(ctx, local, w, h, resolveColor(draft, local.color), basisW());
    }
    for (const pending of remotePendingRef.current.values()) {
      if (pending.mode === "ink") drawItem(ctx, pending, w, h, resolveColor(draft, pending.color), basisW());
    }
  }, [basisW]);

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
      redrawDraft();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [redrawBase, redrawDraft]);

  /* 线宽参照宽度变化（如主板书随窗口调整）→ 重放，保持同屏两板粗细一致。 */
  useEffect(() => {
    redrawBase();
    redrawDraft();
  }, [strokeWidthBasis, redrawBase, redrawDraft]);

  /* 笔迹变更（提交/撤销/清空/远端 op）→ 全量重放。 */
  useEffect(() => {
    // 已入 items 的远端笔迹不再需要 progress 预览
    for (const item of items) remotePendingRef.current.delete(item.id);
    redrawBase();
    redrawDraft();
  }, [items, redrawBase, redrawDraft]);

  /* 主题切换时 token 色值变化，需重放一次。 */
  useEffect(() => {
    const observer = new MutationObserver(() => {
      redrawBase();
      redrawDraft();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      redrawBase();
      redrawDraft();
    };
    media.addEventListener("change", onChange);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", onChange);
    };
  }, [redrawBase, redrawDraft]);

  /* 远端事件：progress 预览与协作光标。 */
  useEffect(() => {
    const offProgress = bus.on("remote-progress", (chunk) => {
      const pending = remotePendingRef.current;
      if (chunk.done) {
        pending.delete(chunk.id);
        redrawDraft();
        return;
      }
      // progress 尾包晚于 commit 到达的兜底：已落定的笔迹不再预览
      if (store.getState().items.some((item) => item.id === chunk.id)) return;
      const existing = pending.get(chunk.id);
      if (existing) {
        existing.points.push(...chunk.points);
      } else {
        pending.set(chunk.id, { id: chunk.id, mode: chunk.mode, color: chunk.color, wNorm: chunk.wNorm, points: [...chunk.points] });
      }
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
    return () => {
      offProgress();
      offCursor();
      clearInterval(prune);
    };
  }, [redrawDraft, bus, store]);

  /* 指针逻辑 */
  useEffect(() => {
    const draft = draftRef.current;
    const base = baseRef.current;
    if (!draft || !base || !editable || tool === "pointer") return;
    const baseCtx = base.getContext("2d");
    if (!baseCtx) return;
    const actions = store.getState();
    let capturedPointerId: number | null = null;

    const toPoint = (event: PointerEvent): [number, number] => {
      const rect = draft.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };

    const eraseHit = (x: number, y: number) => {
      const { w, h } = dimsRef.current;
      const id = hitStrokeId(store.getState().items, x, y, w, h, STROKE_ERASER_THRESHOLD_PX, basisW());
      if (id) actions.eraseLine(id);
    };

    const down = (event: PointerEvent) => {
      const [x, y] = toPoint(event);
      if (tool === "strokeEraser") {
        eraseHit(x, y);
        return;
      }
      const { w, h } = dimsRef.current;
      const erase = tool.startsWith("eraser");
      const stroke: StrokeItem = {
        id: newStrokeId(),
        mode: erase ? "erase" : "ink",
        color,
        wNorm: erase ? ERASER_NORM[tool] ?? 0.02 : sizeNorm,
        points: [[x / w, y / h]],
      };
      strokeRef.current = stroke;
      if (stroke.mode === "ink") bus.emit("local-progress-start", stroke);
      draft.setPointerCapture(event.pointerId);
      capturedPointerId = event.pointerId;
    };

    const move = (event: PointerEvent) => {
      const [x, y] = toPoint(event);
      const { w, h } = dimsRef.current;
      bus.emit("local-cursor", { x: x / w, y: y / h });
      if (tool.startsWith("eraser")) setCursor([x, y]);
      if (tool === "strokeEraser") {
        if (event.buttons & 1) eraseHit(x, y);
        return;
      }
      const stroke = strokeRef.current;
      if (!stroke) return;
      const prev = stroke.points[stroke.points.length - 1];
      stroke.points.push([x / w, y / h]);
      if (stroke.mode === "ink") {
        redrawDraft();
      } else {
        // 碎擦：直接在 base 上增量挖除做即时反馈；提交后由全量重放收敛到同一结果。
        drawItem(baseCtx, { ...stroke, points: [prev, [x / w, y / h]] }, w, h, "#000", basisW());
      }
    };

    const finish = () => {
      if (capturedPointerId !== null) {
        // pointercancel、热更新或节点迁移可能已由浏览器隐式释放 capture。
        // 先检测再释放，避免 Safari/Chromium 抛 NotFoundError。
        try {
          if (draft.hasPointerCapture(capturedPointerId)) draft.releasePointerCapture(capturedPointerId);
        } catch {
          // 检测与释放之间节点仍可能被卸载；capture 已失效时无需处理。
        }
        capturedPointerId = null;
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
  }, [editable, tool, color, sizeNorm, redrawDraft, store, bus, basisW]);

  const interactive = editable && tool !== "pointer";
  const cursorStyle = !interactive ? "default" : tool.startsWith("eraser") ? "none" : "crosshair";
  const eraserSize = (ERASER_NORM[tool] ?? 0) * (strokeWidthBasis && strokeWidthBasis > 0 ? strokeWidthBasis : cssWidth);

  return (
    // 容器不拦截指针：只有 draft 画布按工具态自行开启（课堂里下层还有课件/游戏要点）
    <div ref={containerRef} className="pointer-events-none absolute inset-0">
      <canvas ref={baseRef} className="absolute inset-0 h-full w-full touch-none" style={{ pointerEvents: "none" }} />
      <canvas
        ref={draftRef}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ pointerEvents: interactive ? "auto" : "none", cursor: cursorStyle }}
      />
      {Object.entries(remoteCursors).map(([key, value]) => (
        <div
          key={key}
          aria-hidden
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }}
        >
          <span
            className="block size-2.5 rounded-full border border-paper shadow"
            style={{ background: colorVar(COLOR_TOKENS[Math.abs([...key].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % COLOR_TOKENS.length]) }}
          />
          <span className="mt-1 block max-w-28 truncate rounded-full bg-ink/80 px-1.5 py-0.5 text-[10px] leading-none text-paper">
            {value.name}
          </span>
        </div>
      ))}
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
