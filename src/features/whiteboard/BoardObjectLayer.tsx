"use client";

import { renderToString } from "katex";
import { Copy, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useStore } from "zustand";
import { colorVar } from "./strokes";
import { isEditableObject, resizeObject } from "./geometry";
import type { WhiteboardStore } from "./store";
import {
  isShapeItem,
  type FormulaItem,
  type ShapeItem,
} from "./types";
import { shapePolygonPoints } from "./geometry";

function FormulaContent({ item }: { item: FormulaItem }) {
  const markup = useMemo(
    () => renderToString(item.latex, { output: "mathml", throwOnError: false, strict: "ignore" }),
    [item.latex],
  );
  return (
    <div
      className="flex size-full items-center justify-center overflow-hidden"
      style={{ color: colorVar(item.color), fontSize: "clamp(12px, 4cqw, 48px)" }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

function ShapeGraphic({ item, canvasWidth, canvasHeight }: { item: ShapeItem; canvasWidth: number; canvasHeight: number }) {
  const width = item.width * canvasWidth;
  const height = item.height * canvasHeight;
  const common = {
    fill: item.fill ? colorVar(item.fill) : "none",
    stroke: colorVar(item.color),
    strokeWidth: Math.max(item.strokeWidthNorm * canvasWidth, 1),
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    vectorEffect: "non-scaling-stroke" as const,
  };
  if (item.shape === "line" || item.shape === "arrow") {
    return (
      <g {...common} fill="none">
        <line x1={-width / 2} y1={0} x2={width / 2} y2={0} />
        {item.shape === "arrow" ? (
          <path d={`M ${width / 2} 0 L ${width / 2 - Math.min(width * 0.14, 24)} ${-Math.min(width * 0.08, 13)} M ${width / 2} 0 L ${width / 2 - Math.min(width * 0.14, 24)} ${Math.min(width * 0.08, 13)}`} />
        ) : null}
      </g>
    );
  }
  if (item.shape === "rectangle") return <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={Math.min(8, width * 0.06, height * 0.12)} {...common} />;
  if (item.shape === "ellipse") return <ellipse cx={0} cy={0} rx={width / 2} ry={height / 2} {...common} />;
  if (item.shape === "arc") {
    const radiusX = width / 2;
    const radiusY = height / 2;
    const start = (item.startAngle ?? 0) * Math.PI / 180;
    const sweep = item.sweepAngle ?? 360;
    const end = start + sweep * Math.PI / 180;
    const startPoint = [Math.cos(start) * radiusX, Math.sin(start) * radiusY];
    const endPoint = [Math.cos(end) * radiusX, Math.sin(end) * radiusY];
    const large = Math.abs(sweep) > 180 ? 1 : 0;
    const sweepFlag = sweep >= 0 ? 1 : 0;
    return <path d={`M ${startPoint[0]} ${startPoint[1]} A ${radiusX} ${radiusY} 0 ${large} ${sweepFlag} ${endPoint[0]} ${endPoint[1]}`} {...common} fill="none" />;
  }
  const points = shapePolygonPoints(item.shape)
    .map(([x, y]) => `${(x - 0.5) * width},${(y - 0.5) * height}`)
    .join(" ");
  return <polygon points={points} {...common} />;
}

function ObjectGraphic({ item, canvasWidth, canvasHeight }: { item: ShapeItem | FormulaItem; canvasWidth: number; canvasHeight: number }) {
  const width = item.width * canvasWidth;
  const height = item.height * canvasHeight;
  if (isShapeItem(item)) return <ShapeGraphic item={item} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />;
  return (
    <foreignObject x={-width / 2} y={-height / 2} width={width} height={height} className="pointer-events-none">
      <FormulaContent item={item} />
    </foreignObject>
  );
}

function pointerAngle(event: PointerEvent, centerX: number, centerY: number): number {
  return Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI + 90;
}

export function BoardObjectLayer({
  store,
  editable,
  width,
  height,
  preview,
}: {
  store: WhiteboardStore;
  editable: boolean;
  width: number;
  height: number;
  preview: ShapeItem | null;
}) {
  const t = useTranslations("whiteboard.board.tools");
  const items = useStore(store, (state) => state.items);
  const tool = useStore(store, (state) => state.tool);
  const selectedIds = useStore(store, (state) => state.selectedIds);
  const [transient, setTransient] = useState<ShapeItem | FormulaItem | null>(null);
  const selected = items.find((item): item is ShapeItem | FormulaItem => selectedIds.includes(item.id) && isEditableObject(item));
  const objects = items.filter(isEditableObject).map((item) => transient?.id === item.id ? transient : item);
  const visibleSelected = transient?.id === selected?.id ? transient : selected;

  const beginTransform = (
    event: React.PointerEvent<SVGGElement | SVGCircleElement>,
    item: ShapeItem | FormulaItem,
    mode: "move" | "resize" | "rotate",
  ) => {
    if (!editable || tool !== "pointer") return;
    event.preventDefault();
    event.stopPropagation();
    store.getState().setSelectedIds([item.id]);
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = (event.currentTarget.ownerSVGElement ?? event.currentTarget).getBoundingClientRect();
    const centerX = rect.left + item.x * rect.width;
    const centerY = rect.top + item.y * rect.height;
    const initialAngle = pointerAngle(event.nativeEvent, centerX, centerY);
    let latest: ShapeItem | FormulaItem = item;
    const move = (pointerEvent: PointerEvent) => {
      if (mode === "move") {
        latest = {
          ...item,
          x: Math.min(1, Math.max(0, item.x + (pointerEvent.clientX - startX) / rect.width)),
          y: Math.min(1, Math.max(0, item.y + (pointerEvent.clientY - startY) / rect.height)),
        };
      } else if (mode === "rotate") {
        latest = { ...item, rotation: item.rotation + pointerAngle(pointerEvent, centerX, centerY) - initialAngle };
      } else {
        const angle = -item.rotation * Math.PI / 180;
        const dx = pointerEvent.clientX - centerX;
        const dy = pointerEvent.clientY - centerY;
        const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
        const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
        latest = resizeObject(item, Math.abs(localX * 2 / rect.width), Math.abs(localY * 2 / rect.height)) as ShapeItem | FormulaItem;
      }
      setTransient(latest);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setTransient(null);
      if (latest !== item) store.getState().updateItem(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  return (
    <>
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        viewBox={`0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`}
      >
        {objects.map((item) => (
          <g
            key={item.id}
            className={editable && tool === "pointer" ? "pointer-events-auto cursor-move" : "pointer-events-none"}
            transform={`translate(${item.x * width} ${item.y * height}) rotate(${item.rotation})`}
            onPointerDown={(event) => beginTransform(event, item, "move")}
          >
            <ObjectGraphic item={item} canvasWidth={width} canvasHeight={height} />
            <rect
              x={-item.width * width / 2}
              y={-item.height * height / 2}
              width={item.width * width}
              height={item.height * height}
              fill="transparent"
              stroke="transparent"
              strokeWidth={12}
            />
          </g>
        ))}
        {preview ? (
          <g opacity={0.72} transform={`translate(${preview.x * width} ${preview.y * height}) rotate(${preview.rotation})`}>
            <ObjectGraphic item={preview} canvasWidth={width} canvasHeight={height} />
          </g>
        ) : null}
        {visibleSelected && editable && tool === "pointer" ? (
          <g transform={`translate(${visibleSelected.x * width} ${visibleSelected.y * height}) rotate(${visibleSelected.rotation})`}>
            <rect
              x={-visibleSelected.width * width / 2}
              y={-visibleSelected.height * height / 2}
              width={visibleSelected.width * width}
              height={visibleSelected.height * height}
              fill="none"
              stroke="var(--crater)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
            <line y1={-visibleSelected.height * height / 2} y2={-visibleSelected.height * height / 2 - 24} stroke="var(--crater)" strokeWidth={1.5} />
            <circle
              className="pointer-events-auto cursor-grab"
              cx={0}
              cy={-visibleSelected.height * height / 2 - 28}
              r={6}
              fill="var(--paper)"
              stroke="var(--crater)"
              strokeWidth={2}
              onPointerDown={(event) => beginTransform(event, visibleSelected, "rotate")}
            />
            <circle
              className="pointer-events-auto cursor-nwse-resize"
              cx={visibleSelected.width * width / 2}
              cy={visibleSelected.height * height / 2}
              r={6}
              fill="var(--paper)"
              stroke="var(--crater)"
              strokeWidth={2}
              onPointerDown={(event) => beginTransform(event, visibleSelected, "resize")}
            />
          </g>
        ) : null}
      </svg>
      {visibleSelected && editable && tool === "pointer" ? (
        <div
          className="pointer-events-auto absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-paper/95 p-1 shadow-md backdrop-blur"
          style={{ left: `${visibleSelected.x * 100}%`, top: `${Math.max(2, (visibleSelected.y - visibleSelected.height / 2) * 100)}%`, transform: "translate(-50%, calc(-100% - 10px))" }}
        >
          <button type="button" className="grid size-8 place-items-center rounded-full text-muted hover:bg-moon/40 hover:text-ink" aria-label={t("duplicate")} title={t("duplicate")} onClick={() => store.getState().duplicateSelected()}>
            <Copy size={15} />
          </button>
          <button type="button" className="grid size-8 place-items-center rounded-full text-rose hover:bg-rose/10" aria-label={t("deleteSelection")} title={t("deleteSelection")} onClick={() => store.getState().removeItems(selectedIds)}>
            <Trash2 size={15} />
          </button>
        </div>
      ) : null}
    </>
  );
}
