"use client";

import { Move, Pencil, X } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useStore } from "zustand";
import { newId } from "@/lib/uuid";
import { clamp, ellipseArcPath, normalizeDegrees, shortestAngleDelta } from "./geometry";
import type { WhiteboardStore } from "./store";
import type { InstrumentItem, ShapeItem } from "./types";

function rotatePoint(x: number, y: number, degrees: number): [number, number] {
  const angle = degrees * Math.PI / 180;
  return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
}

function RulerTicks({ width, height }: { width: number; height: number }) {
  const count = 20;
  return (
    <>
      {Array.from({ length: count + 1 }, (_, index) => {
        const x = -width / 2 + index * width / count;
        const tick = index % 5 === 0 ? height * 0.42 : index % 2 === 0 ? height * 0.28 : height * 0.18;
        return <line key={index} x1={x} y1={-height / 2} x2={x} y2={-height / 2 + tick} stroke="currentColor" strokeWidth={1} opacity={0.7} />;
      })}
    </>
  );
}

function ProtractorTicks({ width, height }: { width: number; height: number }) {
  return (
    <>
      {Array.from({ length: 19 }, (_, index) => {
        const angle = Math.PI + index * Math.PI / 18;
        const outerX = Math.cos(angle) * width / 2;
        const outerY = Math.sin(angle) * height;
        const ratio = index % 3 === 0 ? 0.78 : 0.88;
        return <line key={index} x1={outerX * ratio} y1={outerY * ratio} x2={outerX} y2={outerY} stroke="currentColor" strokeWidth={1} opacity={0.65} />;
      })}
    </>
  );
}

export function InstrumentLayer({ store, editable, width, height }: { store: WhiteboardStore; editable: boolean; width: number; height: number }) {
  const t = useTranslations("whiteboard.board.tools");
  const instruments = useStore(store, (state) => state.instruments);
  const color = useStore(store, (state) => state.color);
  const sizeNorm = useStore(store, (state) => state.sizeNorm);
  const [preview, setPreview] = useState<ShapeItem | null>(null);
  if (!editable || instruments.length === 0) return null;

  const boardRect = (target: SVGElement) => target.ownerSVGElement?.getBoundingClientRect() ?? target.getBoundingClientRect();

  const beginAdjust = (
    event: React.PointerEvent<SVGElement>,
    item: InstrumentItem,
    mode: "move" | "rotate" | "resize" | "radius",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = boardRect(event.currentTarget);
    const startX = event.clientX;
    const startY = event.clientY;
    const centerX = rect.left + item.x * rect.width;
    const centerY = rect.top + item.y * rect.height;
    const initialAngle = Math.atan2(startY - centerY, startX - centerX) * 180 / Math.PI;
    const move = (pointerEvent: PointerEvent) => {
      let next = item;
      if (mode === "move") {
        next = {
          ...item,
          x: clamp(item.x + (pointerEvent.clientX - startX) / rect.width),
          y: clamp(item.y + (pointerEvent.clientY - startY) / rect.height),
        };
      } else if (mode === "rotate") {
        const angle = Math.atan2(pointerEvent.clientY - centerY, pointerEvent.clientX - centerX) * 180 / Math.PI;
        next = { ...item, rotation: normalizeDegrees(item.rotation + angle - initialAngle) };
      } else if (mode === "resize") {
        const dx = pointerEvent.clientX - centerX;
        const dy = pointerEvent.clientY - centerY;
        const local = rotatePoint(dx, dy, -item.rotation);
        next = { ...item, width: clamp(Math.abs(local[0]) * 2 / rect.width, 0.16, 0.85) };
      } else {
        const radius = Math.hypot(pointerEvent.clientX - centerX, pointerEvent.clientY - centerY) / rect.width;
        next = { ...item, radius: clamp(radius, 0.04, 0.34), width: clamp(radius * 2, 0.1, 0.7) };
      }
      store.getState().updateInstrument(next);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  const beginRulerLine = (event: React.PointerEvent<SVGRectElement>, item: InstrumentItem) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = boardRect(event.currentTarget);
    const toEdgePoint = (pointerEvent: Pick<PointerEvent, "clientX" | "clientY">): [number, number] => {
      const centerX = rect.left + item.x * rect.width;
      const centerY = rect.top + item.y * rect.height;
      const local = rotatePoint(pointerEvent.clientX - centerX, pointerEvent.clientY - centerY, -item.rotation);
      const localX = Math.max(-item.width * rect.width / 2, Math.min(item.width * rect.width / 2, local[0]));
      const localY = -item.height * rect.height / 2;
      const global = rotatePoint(localX, localY, item.rotation);
      return [(centerX + global[0] - rect.left) / rect.width, (centerY + global[1] - rect.top) / rect.height];
    };
    const start = toEdgePoint(event.nativeEvent);
    let end = start;
    const move = (pointerEvent: PointerEvent) => {
      end = toEdgePoint(pointerEvent);
      setPreview({
        id: "instrument-preview",
        kind: "shape",
        shape: "line",
        color,
        fill: null,
        strokeWidthNorm: sizeNorm,
        x: (start[0] + end[0]) / 2,
        y: (start[1] + end[1]) / 2,
        width: Math.max(Math.hypot(end[0] - start[0], end[1] - start[1]), 0.006),
        height: 0.002,
        rotation: Math.atan2((end[1] - start[1]) * rect.height, (end[0] - start[0]) * rect.width) * 180 / Math.PI,
      });
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      const final = preview;
      setPreview(null);
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (distance > 0.008) {
        store.getState().commitItem({
          id: newId(), kind: "shape", shape: "line", color, fill: null, strokeWidthNorm: sizeNorm,
          x: (start[0] + end[0]) / 2, y: (start[1] + end[1]) / 2,
          width: distance, height: 0.002,
          rotation: Math.atan2((end[1] - start[1]) * rect.height, (end[0] - start[0]) * rect.width) * 180 / Math.PI,
        });
      } else if (final) {
        setPreview(null);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  const beginCompassArc = (event: React.PointerEvent<SVGElement>, item: InstrumentItem) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = boardRect(event.currentTarget);
    const centerX = rect.left + item.x * rect.width;
    const centerY = rect.top + item.y * rect.height;
    const radius = item.radius ?? item.width / 2;
    const angleAt = (pointerEvent: Pick<PointerEvent, "clientX" | "clientY">) => Math.atan2(pointerEvent.clientY - centerY, pointerEvent.clientX - centerX) * 180 / Math.PI;
    const start = angleAt(event.nativeEvent);
    let previous = start;
    let sweep = 0;
    let finalArc: ShapeItem | null = null;
    const move = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      const current = angleAt(pointerEvent);
      sweep += shortestAngleDelta(previous, current);
      previous = current;
      store.getState().updateInstrument({ ...item, armAngle: normalizeDegrees(current) });
      finalArc = {
        id: "instrument-preview", kind: "shape", shape: "arc", color, fill: null, strokeWidthNorm: sizeNorm,
        x: item.x, y: item.y, width: radius * 2, height: radius * 2 * rect.width / rect.height,
        rotation: 0, startAngle: start, sweepAngle: sweep,
      };
      setPreview(finalArc);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setPreview(null);
      if (finalArc && Math.abs(finalArc.sweepAngle ?? 0) > 3) {
        store.getState().commitItem({ ...finalArc, id: newId() });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  const beginProtractorRay = (event: React.PointerEvent<SVGCircleElement>, item: InstrumentItem) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = boardRect(event.currentTarget);
    const pivotLocal: [number, number] = [0, item.height * rect.height / 2];
    const centerX = rect.left + item.x * rect.width;
    const centerY = rect.top + item.y * rect.height;
    const globalPivotOffset = rotatePoint(pivotLocal[0], pivotLocal[1], item.rotation);
    const pivot: [number, number] = [(centerX + globalPivotOffset[0] - rect.left) / rect.width, (centerY + globalPivotOffset[1] - rect.top) / rect.height];
    let end = pivot;
    let shownAngle = 0;
    const move = (pointerEvent: PointerEvent) => {
      const local = rotatePoint(pointerEvent.clientX - (centerX + globalPivotOffset[0]), pointerEvent.clientY - (centerY + globalPivotOffset[1]), -item.rotation);
      const localAngle = Math.max(-180, Math.min(0, Math.atan2(local[1], local[0]) * 180 / Math.PI));
      shownAngle = Math.round(Math.abs(localAngle));
      const length = Math.min(item.width * rect.width / 2, Math.max(30, Math.hypot(local[0], local[1])));
      const localEnd = [Math.cos(localAngle * Math.PI / 180) * length, Math.sin(localAngle * Math.PI / 180) * length] as [number, number];
      const globalEnd = rotatePoint(localEnd[0], localEnd[1], item.rotation);
      end = [(centerX + globalPivotOffset[0] + globalEnd[0] - rect.left) / rect.width, (centerY + globalPivotOffset[1] + globalEnd[1] - rect.top) / rect.height];
      setPreview({
        id: "instrument-preview", kind: "shape", shape: "line", color, fill: null, strokeWidthNorm: sizeNorm,
        x: (pivot[0] + end[0]) / 2, y: (pivot[1] + end[1]) / 2,
        width: Math.hypot(end[0] - pivot[0], end[1] - pivot[1]), height: 0.002,
        rotation: Math.atan2((end[1] - pivot[1]) * rect.height, (end[0] - pivot[0]) * rect.width) * 180 / Math.PI,
      });
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setPreview(null);
      if (shownAngle > 0) {
        store.getState().commitItem({
          id: newId(), kind: "shape", shape: "line", color, fill: null, strokeWidthNorm: sizeNorm,
          x: (pivot[0] + end[0]) / 2, y: (pivot[1] + end[1]) / 2,
          width: Math.hypot(end[0] - pivot[0], end[1] - pivot[1]), height: 0.002,
          rotation: Math.atan2((end[1] - pivot[1]) * rect.height, (end[0] - pivot[0]) * rect.width) * 180 / Math.PI,
        });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  return (
    <svg className="pointer-events-none absolute inset-0 z-20 size-full overflow-visible" viewBox={`0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`}>
      {preview ? (
        <g transform={`translate(${preview.x * width} ${preview.y * height}) rotate(${preview.rotation})`} opacity={0.7}>
          {preview.shape === "arc" ? (
            <path
              d={ellipseArcPath(preview.width * width, preview.height * height, preview.startAngle ?? 0, preview.sweepAngle ?? 0)}
              fill="none"
              stroke={`var(--${preview.color})`}
              strokeWidth={Math.max(preview.strokeWidthNorm * width, 1)}
              strokeLinecap="round"
            />
          ) : (
            <line x1={-preview.width * width / 2} x2={preview.width * width / 2} stroke={`var(--${preview.color})`} strokeWidth={Math.max(preview.strokeWidthNorm * width, 1)} />
          )}
        </g>
      ) : null}
      {instruments.map((item) => {
        const instrumentWidth = item.width * width;
        const instrumentHeight = item.height * height;
        if (item.kind === "ruler") {
          return (
            <g key={item.id} className="pointer-events-auto text-ink drop-shadow-sm" transform={`translate(${item.x * width} ${item.y * height}) rotate(${item.rotation})`}>
              <rect x={-instrumentWidth / 2} y={-instrumentHeight / 2} width={instrumentWidth} height={instrumentHeight} rx={6} fill="color-mix(in srgb, var(--crater) 24%, transparent)" stroke="var(--crater)" strokeWidth={1.5} onPointerDown={(event) => beginAdjust(event, item, "move")} />
              <RulerTicks width={instrumentWidth} height={instrumentHeight} />
              <text x={0} y={instrumentHeight * 0.27} textAnchor="middle" fontSize={Math.max(10, instrumentHeight * 0.22)} fill="currentColor">20 cm · {Math.round(item.rotation)}°</text>
              <rect x={-instrumentWidth / 2} y={-instrumentHeight / 2 - 10} width={instrumentWidth} height={18} fill="transparent" className="cursor-crosshair" onPointerDown={(event) => beginRulerLine(event, item)} />
              <circle cx={instrumentWidth / 2 + 10} cy={0} r={8} fill="var(--paper)" stroke="var(--crater)" className="cursor-ew-resize" onPointerDown={(event) => beginAdjust(event, item, "resize")} />
              <circle cx={-instrumentWidth / 2} cy={-instrumentHeight / 2 - 22} r={7} fill="var(--paper)" stroke="var(--crater)" className="cursor-grab" onPointerDown={(event) => beginAdjust(event, item, "rotate")} />
              <g transform={`translate(${instrumentWidth / 2 + 26} ${-instrumentHeight / 2})`} className="cursor-pointer" onPointerDown={() => store.getState().removeInstrument(item.id)}><circle r={9} fill="var(--paper)" stroke="var(--line)" /><X x={-6} y={-6} width={12} height={12} /></g>
            </g>
          );
        }
        if (item.kind === "compass") {
          const radiusPx = (item.radius ?? item.width / 2) * width;
          const angle = item.armAngle ?? -25;
          const tip = rotatePoint(radiusPx, 0, angle);
          return (
            <g key={item.id} className="pointer-events-auto touch-none text-ink drop-shadow-sm">
              <g className="cursor-move" onPointerDown={(event) => beginAdjust(event, item, "move")}>
                <circle cx={item.x * width} cy={item.y * height} r={22} fill="transparent" />
                <circle cx={item.x * width} cy={item.y * height} r={13} fill="var(--paper)" stroke="var(--crater)" strokeWidth={2} />
                <Move x={item.x * width - 7} y={item.y * height - 7} width={14} height={14} pointerEvents="none" />
              </g>
              <line x1={item.x * width} y1={item.y * height} x2={item.x * width + tip[0]} y2={item.y * height + tip[1]} stroke="color-mix(in srgb, var(--crater) 70%, var(--paper))" strokeWidth={12} strokeLinecap="round" />
              <line x1={item.x * width} y1={item.y * height} x2={item.x * width - tip[0] * 0.62} y2={item.y * height - tip[1] * 0.62} stroke="var(--ink)" strokeWidth={5} strokeLinecap="round" />
              <g className="cursor-ew-resize" onPointerDown={(event) => beginAdjust(event, item, "radius")}>
                <circle cx={item.x * width + tip[0] * 0.55} cy={item.y * height + tip[1] * 0.55} r={17} fill="transparent" />
                <circle cx={item.x * width + tip[0] * 0.55} cy={item.y * height + tip[1] * 0.55} r={8} fill="var(--paper)" stroke="var(--crater)" strokeWidth={2} />
              </g>
              <g className="cursor-crosshair" onPointerDown={(event) => beginCompassArc(event, item)}>
                <circle cx={item.x * width + tip[0]} cy={item.y * height + tip[1]} r={24} fill="transparent" />
                <circle cx={item.x * width + tip[0]} cy={item.y * height + tip[1]} r={15} fill="var(--paper)" stroke="var(--rose)" strokeWidth={2} strokeDasharray="3 2" />
                <Pencil x={item.x * width + tip[0] - 7} y={item.y * height + tip[1] - 7} width={14} height={14} color="var(--rose)" pointerEvents="none" />
              </g>
              <g transform={`translate(${item.x * width + 22} ${item.y * height - 22})`} className="cursor-pointer" onPointerDown={() => store.getState().removeInstrument(item.id)}><circle r={9} fill="var(--paper)" stroke="var(--line)" /><X x={-6} y={-6} width={12} height={12} /></g>
              <title>{t("compassHint")}</title>
            </g>
          );
        }
        return (
          <g key={item.id} className="pointer-events-auto text-ink drop-shadow-sm" transform={`translate(${item.x * width} ${item.y * height}) rotate(${item.rotation})`}>
            <path d={`M ${-instrumentWidth / 2} ${instrumentHeight / 2} A ${instrumentWidth / 2} ${instrumentHeight} 0 0 1 ${instrumentWidth / 2} ${instrumentHeight / 2} L 0 ${instrumentHeight / 2} Z`} fill="color-mix(in srgb, var(--leaf) 20%, transparent)" stroke="var(--leaf-deep)" strokeWidth={1.5} onPointerDown={(event) => beginAdjust(event, item, "move")} />
            <ProtractorTicks width={instrumentWidth} height={instrumentHeight} />
            <line x1={-instrumentWidth / 2} x2={instrumentWidth / 2} y1={instrumentHeight / 2} y2={instrumentHeight / 2} stroke="var(--leaf-deep)" />
            <circle cx={0} cy={instrumentHeight / 2} r={12} fill="transparent" stroke="var(--leaf-deep)" strokeDasharray="3 2" className="cursor-crosshair" onPointerDown={(event) => beginProtractorRay(event, item)} />
            <circle cx={0} cy={-instrumentHeight - 18} r={7} fill="var(--paper)" stroke="var(--leaf-deep)" className="cursor-grab" onPointerDown={(event) => beginAdjust(event, item, "rotate")} />
            <g transform={`translate(${instrumentWidth / 2 + 18} ${instrumentHeight / 2})`} className="cursor-pointer" onPointerDown={() => store.getState().removeInstrument(item.id)}><circle r={9} fill="var(--paper)" stroke="var(--line)" /><X x={-6} y={-6} width={12} height={12} /></g>
            <title>{t("protractorHint")}</title>
          </g>
        );
      })}
    </svg>
  );
}
