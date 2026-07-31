"use client";

import { PenLine, ScanLine, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { drawItem, newStrokeId, resolveColor } from "./strokes";
import type { ColorToken, StrokeItem } from "./types";

export interface FormulaPadBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_PAD_WIDTH_PX = 280;
const MIN_PAD_HEIGHT_PX = 160;

export function fitFormulaPadBounds(
  bounds: FormulaPadBounds,
  canvasWidth: number,
  canvasHeight: number,
): FormulaPadBounds {
  const minWidth = Math.min(0.94, MIN_PAD_WIDTH_PX / Math.max(canvasWidth, 1));
  const minHeight = Math.min(0.9, MIN_PAD_HEIGHT_PX / Math.max(canvasHeight, 1));
  const width = Math.min(1, Math.max(bounds.width, minWidth));
  const height = Math.min(1, Math.max(bounds.height, minHeight));
  return {
    x: Math.max(0, Math.min(bounds.x, 1 - width)),
    y: Math.max(0, Math.min(bounds.y, 1 - height)),
    width,
    height,
  };
}

export function FormulaInkPad({
  bounds,
  canvasWidth,
  strokeWidthBasis,
  color,
  sizeNorm,
  strokes,
  disabled,
  onAppend,
  onUndo,
  onClear,
  onRecognize,
  onKeepInk,
  onDiscard,
}: {
  bounds: FormulaPadBounds;
  canvasWidth: number;
  strokeWidthBasis?: number;
  color: ColorToken;
  sizeNorm: number;
  strokes: StrokeItem[];
  disabled: boolean;
  onAppend: (stroke: StrokeItem) => void;
  onUndo: () => void;
  onClear: () => void;
  onRecognize: () => void;
  onKeepInk: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations("whiteboard.board.tools");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeStrokeRef = useRef<StrokeItem | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    ctx.clearRect(0, 0, width, height);
    const basis = strokeWidthBasis && strokeWidthBasis > 0 ? strokeWidthBasis : canvasWidth;
    for (const stroke of [...strokes, ...(activeStrokeRef.current ? [activeStrokeRef.current] : [])]) {
      const localStroke: StrokeItem = {
        ...stroke,
        points: stroke.points.map(([x, y]) => [
          (x - bounds.x) / bounds.width,
          (y - bounds.y) / bounds.height,
        ]),
      };
      drawItem(ctx, localStroke, width, height, resolveColor(canvas, localStroke.color), basis);
    }
  }, [bounds, canvasWidth, strokeWidthBasis, strokes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [redraw]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const pointForEvent = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const localY = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
    return [
      bounds.x + (localX / Math.max(rect.width, 1)) * bounds.width,
      bounds.y + (localY / Math.max(rect.height, 1)) * bounds.height,
    ];
  };

  const finishStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // 节点卸载时 capture 已隐式释放。
    }
    pointerIdRef.current = null;
    const stroke = activeStrokeRef.current;
    activeStrokeRef.current = null;
    if (stroke) onAppend(stroke);
  };

  return (
    <div
      className="pointer-events-auto absolute z-40 overflow-hidden rounded-xl border-2 border-crater bg-paper/95 shadow-lg"
      style={{
        left: `${bounds.x * 100}%`,
        top: `${bounds.y * 100}%`,
        width: `${bounds.width * 100}%`,
        height: `${bounds.height * 100}%`,
      }}
      aria-label={t("formulaPadLabel")}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor: disabled ? "wait" : "crosshair", pointerEvents: disabled ? "none" : "auto" }}
        onPointerDown={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerIdRef.current = event.pointerId;
          activeStrokeRef.current = {
            id: newStrokeId(),
            mode: "ink",
            color,
            wNorm: sizeNorm,
            points: [pointForEvent(event)],
          };
          redraw();
        }}
        onPointerMove={(event) => {
          if (pointerIdRef.current !== event.pointerId || !activeStrokeRef.current) return;
          activeStrokeRef.current.points.push(pointForEvent(event));
          redraw();
        }}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
      />
      {strokes.length === 0 ? (
        <p className="pointer-events-none absolute inset-0 grid place-items-center px-12 text-center text-sm text-muted">
          {t("formulaPadHint")}
        </p>
      ) : null}
      <div className="pointer-events-auto absolute right-2 top-2 flex items-center gap-1 rounded-full border border-line bg-paper/95 p-1 shadow-sm">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-7 p-0"
          disabled={disabled || strokes.length === 0}
          onClick={onUndo}
          title={t("formulaPadUndo")}
          aria-label={t("formulaPadUndo")}
        >
          <Undo2 size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-7 p-0"
          disabled={disabled || strokes.length === 0}
          onClick={onClear}
          title={t("formulaPadClear")}
          aria-label={t("formulaPadClear")}
        >
          <Trash2 size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-7 p-0"
          disabled={disabled || strokes.length === 0}
          onClick={onKeepInk}
          title={t("formulaPadKeepInk")}
          aria-label={t("formulaPadKeepInk")}
        >
          <PenLine size={14} />
        </Button>
        <Button
          type="button"
          size="sm"
          className="size-7 p-0"
          disabled={disabled || strokes.length === 0}
          onClick={onRecognize}
          title={t("formulaPadRecognize")}
          aria-label={t("formulaPadRecognize")}
        >
          <ScanLine size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-7 p-0"
          disabled={disabled}
          onClick={onDiscard}
          title={t("formulaPadDiscard")}
          aria-label={t("formulaPadDiscard")}
        >
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
