"use client";

import { Move, Pencil, RotateCw, X } from "lucide-react";
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

function compassRadiusNorm(item: InstrumentItem, boardWidth: number): number {
  const configured = item.radius ?? item.width / 2;
  return Math.max(configured, Math.min(0.22, 44 / Math.max(boardWidth, 1)));
}

function RulerTicks({ width, height }: { width: number; height: number }) {
  const subdivisions = 200;
  const labelSize = Math.max(7, Math.min(10, height * 0.17));
  return (
    <g pointerEvents="none">
      {Array.from({ length: subdivisions + 1 }, (_, index) => {
        const x = -width / 2 + index * width / subdivisions;
        const isCentimeter = index % 10 === 0;
        const isHalf = !isCentimeter && index % 5 === 0;
        const tick = isCentimeter ? height * 0.4 : isHalf ? height * 0.25 : height * 0.16;
        return (
          <line
            key={index}
            x1={x}
            y1={-height / 2}
            x2={x}
            y2={-height / 2 + tick}
            stroke="currentColor"
            strokeWidth={isCentimeter ? 1.25 : 0.7}
            opacity={isCentimeter ? 0.82 : 0.52}
          />
        );
      })}
      {Array.from({ length: 5 }, (_, index) => {
        const value = index * 5;
        const x = -width / 2 + value * width / 20;
        const anchor = index === 0 ? "start" : index === 4 ? "end" : "middle";
        return (
          <text
            key={value}
            x={x}
            y={-height * 0.02}
            textAnchor={anchor}
            fontSize={labelSize}
            fill="currentColor"
            opacity={0.74}
          >
            {value}
          </text>
        );
      })}
    </g>
  );
}

function ProtractorTicks({ width, height }: { width: number; height: number }) {
  const centerY = height / 2;
  const labelSize = Math.max(7, Math.min(10, height * 0.105));
  return (
    <g pointerEvents="none">
      {Array.from({ length: 37 }, (_, index) => {
        const degrees = index * 5;
        const angle = Math.PI + degrees * Math.PI / 180;
        const major = degrees % 10 === 0;
        const ratio = major ? 0.84 : 0.91;
        const outerX = Math.cos(angle) * width / 2;
        const outerY = centerY + Math.sin(angle) * height;
        const innerX = Math.cos(angle) * width / 2 * ratio;
        const innerY = centerY + Math.sin(angle) * height * ratio;
        return (
          <line
            key={degrees}
            x1={innerX}
            y1={innerY}
            x2={outerX}
            y2={outerY}
            stroke="currentColor"
            strokeWidth={major ? 1.15 : 0.65}
            opacity={major ? 0.76 : 0.48}
          />
        );
      })}
      {[0, 30, 60, 90, 120, 150, 180].map((degrees) => {
        const angle = Math.PI + degrees * Math.PI / 180;
        const outerRatio = degrees === 0 || degrees === 180 ? 0.76 : 0.72;
        const innerRatio = degrees === 0 || degrees === 180 ? 0.61 : 0.58;
        return (
          <g key={degrees}>
            <text
              x={Math.cos(angle) * width / 2 * outerRatio}
              y={centerY + Math.sin(angle) * height * outerRatio}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={labelSize}
              fill="currentColor"
              opacity={0.76}
            >
              {degrees}
            </text>
            {degrees === 90 ? null : (
              <text
                x={Math.cos(angle) * width / 2 * innerRatio}
                y={centerY + Math.sin(angle) * height * innerRatio}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={labelSize * 0.88}
                fill="currentColor"
                opacity={0.52}
              >
                {180 - degrees}
              </text>
            )}
          </g>
        );
      })}
    </g>
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

  const beginAnchoredRotate = (
    event: React.PointerEvent<SVGElement>,
    item: InstrumentItem,
    pivotLocal: [number, number],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = boardRect(event.currentTarget);
    const centerX = rect.left + item.x * rect.width;
    const centerY = rect.top + item.y * rect.height;
    const pivotOffset = rotatePoint(pivotLocal[0], pivotLocal[1], item.rotation);
    const pivotX = centerX + pivotOffset[0];
    const pivotY = centerY + pivotOffset[1];
    let previousPointerAngle = Math.atan2(event.clientY - pivotY, event.clientX - pivotX) * 180 / Math.PI;
    let rotationDelta = 0;
    const move = (pointerEvent: PointerEvent) => {
      const pointerAngle = Math.atan2(pointerEvent.clientY - pivotY, pointerEvent.clientX - pivotX) * 180 / Math.PI;
      rotationDelta += shortestAngleDelta(previousPointerAngle, pointerAngle);
      previousPointerAngle = pointerAngle;
      const rotation = normalizeDegrees(item.rotation + rotationDelta);
      const nextPivotOffset = rotatePoint(pivotLocal[0], pivotLocal[1], rotation);
      store.getState().updateInstrument({
        ...item,
        x: (pivotX - rect.left - nextPivotOffset[0]) / rect.width,
        y: (pivotY - rect.top - nextPivotOffset[1]) / rect.height,
        rotation,
      });
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

  const beginAdjust = (
    event: React.PointerEvent<SVGElement>,
    item: InstrumentItem,
    mode: "move" | "resize" | "radius",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = boardRect(event.currentTarget);
    const startX = event.clientX;
    const startY = event.clientY;
    const centerX = rect.left + item.x * rect.width;
    const centerY = rect.top + item.y * rect.height;
    const initialRadius = compassRadiusNorm(item, rect.width);
    const initialPointerRadius = Math.hypot(startX - centerX, startY - centerY) / rect.width;
    const move = (pointerEvent: PointerEvent) => {
      let next = item;
      if (mode === "move") {
        next = {
          ...item,
          x: clamp(item.x + (pointerEvent.clientX - startX) / rect.width),
          y: clamp(item.y + (pointerEvent.clientY - startY) / rect.height),
        };
      } else if (mode === "resize") {
        const dx = pointerEvent.clientX - centerX;
        const dy = pointerEvent.clientY - centerY;
        const local = rotatePoint(dx, dy, -item.rotation);
        next = { ...item, width: clamp(Math.abs(local[0]) * 2 / rect.width, 0.16, 0.85) };
      } else {
        const pointerRadius = Math.hypot(pointerEvent.clientX - centerX, pointerEvent.clientY - centerY) / rect.width;
        const radius = initialRadius + pointerRadius - initialPointerRadius;
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
    const radius = compassRadiusNorm(item, rect.width);
    const angleAt = (pointerEvent: Pick<PointerEvent, "clientX" | "clientY">) => Math.atan2(pointerEvent.clientY - centerY, pointerEvent.clientX - centerX) * 180 / Math.PI;
    const start = item.armAngle ?? -25;
    let previousPointerAngle = angleAt(event.nativeEvent);
    let sweep = 0;
    let finalArc: ShapeItem | null = null;
    const move = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      const pointerAngle = angleAt(pointerEvent);
      sweep += shortestAngleDelta(previousPointerAngle, pointerAngle);
      previousPointerAngle = pointerAngle;
      store.getState().updateInstrument({ ...item, armAngle: normalizeDegrees(start + sweep) });
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
  const beginProtractorRay = (event: React.PointerEvent<SVGElement>, item: InstrumentItem) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = boardRect(event.currentTarget);
    const pivotLocal: [number, number] = [0, item.width * rect.width / 4];
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
    <svg className="pointer-events-none absolute inset-0 z-40 size-full overflow-visible" viewBox={`0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`}>
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
              <rect
                x={-instrumentWidth / 2}
                y={-instrumentHeight / 2}
                width={instrumentWidth}
                height={instrumentHeight}
                rx={5}
                fill="color-mix(in srgb, var(--moon) 42%, transparent)"
                stroke="var(--crater)"
                strokeWidth={1.5}
                className="cursor-move"
                onPointerDown={(event) => beginAdjust(event, item, "move")}
              />
              <rect
                x={-instrumentWidth / 2 + 4}
                y={-instrumentHeight / 2 + 4}
                width={Math.max(0, instrumentWidth - 8)}
                height={Math.max(0, instrumentHeight - 8)}
                rx={3}
                fill="none"
                stroke="color-mix(in srgb, var(--paper) 70%, transparent)"
                strokeWidth={1}
                pointerEvents="none"
              />
              <path
                d={`M ${-instrumentWidth / 2 + 5} ${-instrumentHeight * 0.13} H ${instrumentWidth / 2 - 5}`}
                stroke="color-mix(in srgb, var(--crater) 35%, transparent)"
                strokeWidth={1}
                pointerEvents="none"
              />
              <RulerTicks width={instrumentWidth} height={instrumentHeight} />
              <rect
                x={-instrumentWidth * 0.14}
                y={instrumentHeight * 0.16}
                width={instrumentWidth * 0.28}
                height={Math.max(5, instrumentHeight * 0.16)}
                rx={instrumentHeight * 0.08}
                fill="color-mix(in srgb, var(--paper) 58%, transparent)"
                stroke="color-mix(in srgb, var(--crater) 55%, transparent)"
                pointerEvents="none"
              />
              <text
                x={instrumentWidth * 0.22}
                y={instrumentHeight * 0.32}
                textAnchor="middle"
                fontSize={Math.max(8, instrumentHeight * 0.16)}
                fill="currentColor"
                opacity={0.68}
                pointerEvents="none"
              >
                20 cm · {Math.round(item.rotation)}°
              </text>
              <rect x={-instrumentWidth / 2} y={-instrumentHeight / 2 - 10} width={instrumentWidth} height={18} fill="transparent" className="cursor-crosshair" onPointerDown={(event) => beginRulerLine(event, item)} />
              <g transform={`translate(${-instrumentWidth / 2} ${-instrumentHeight / 2})`} className="cursor-move" onPointerDown={(event) => beginAdjust(event, item, "move")}>
                <circle r={9} fill="var(--paper)" stroke="var(--crater)" strokeWidth={1.5} />
                <Move x={-5} y={-5} width={10} height={10} pointerEvents="none" />
              </g>
              <g transform={`translate(${instrumentWidth / 2} ${-instrumentHeight / 2})`} className="cursor-grab" onPointerDown={(event) => beginAnchoredRotate(event, item, [-instrumentWidth / 2, -instrumentHeight / 2])}>
                <circle r={9} fill="var(--paper)" stroke="var(--crater)" strokeWidth={1.5} />
                <RotateCw x={-5} y={-5} width={10} height={10} pointerEvents="none" />
              </g>
              <circle cx={instrumentWidth / 2 + 10} cy={0} r={8} fill="var(--paper)" stroke="var(--crater)" className="cursor-ew-resize" onPointerDown={(event) => beginAdjust(event, item, "resize")} />
              <g transform={`translate(${instrumentWidth / 2 + 26} ${-instrumentHeight / 2})`} className="cursor-pointer" onPointerDown={() => store.getState().removeInstrument(item.id)}><circle r={9} fill="var(--paper)" stroke="var(--line)" /><X x={-6} y={-6} width={12} height={12} /></g>
            </g>
          );
        }
        if (item.kind === "compass") {
          const radiusPx = compassRadiusNorm(item, width) * width;
          const angle = item.armAngle ?? -25;
          const angleRadians = angle * Math.PI / 180;
          const directionX = Math.cos(angleRadians);
          const directionY = Math.sin(angleRadians);
          const outwardX = Math.sin(angleRadians);
          const outwardY = -Math.cos(angleRadians);
          const centerX = item.x * width;
          const centerY = item.y * height;
          const tipX = centerX + directionX * radiusPx;
          const tipY = centerY + directionY * radiusPx;
          const hingeLift = clamp(radiusPx * 0.52, 40, 76);
          const hingeX = centerX + directionX * radiusPx / 2 + outwardX * hingeLift;
          const hingeY = centerY + directionY * radiusPx / 2 + outwardY * hingeLift;
          const needleLegLength = Math.max(1, Math.hypot(centerX - hingeX, centerY - hingeY));
          const needleDirectionX = (centerX - hingeX) / needleLegLength;
          const needleDirectionY = (centerY - hingeY) / needleLegLength;
          const needleSideX = -needleDirectionY;
          const needleSideY = needleDirectionX;
          const needleShoulderX = centerX - needleDirectionX * 9;
          const needleShoulderY = centerY - needleDirectionY * 9;
          const pencilTopX = hingeX + (tipX - hingeX) * 0.62;
          const pencilTopY = hingeY + (tipY - hingeY) * 0.62;
          const needleBraceX = hingeX + (centerX - hingeX) * 0.52;
          const needleBraceY = hingeY + (centerY - hingeY) * 0.52;
          const pencilBraceX = hingeX + (tipX - hingeX) * 0.52;
          const pencilBraceY = hingeY + (tipY - hingeY) * 0.52;
          const braceMidX = (needleBraceX + pencilBraceX) / 2;
          const braceMidY = (needleBraceY + pencilBraceY) / 2;
          const moveBadgeX = hingeX + (centerX - hingeX) * 0.67 + needleSideX * 13;
          const moveBadgeY = hingeY + (centerY - hingeY) * 0.67 + needleSideY * 13;
          const pencilHitStartX = hingeX + (tipX - hingeX) * 0.17;
          const pencilHitStartY = hingeY + (tipY - hingeY) * 0.17;
          const radiusHandleX = centerX + directionX * radiusPx * 0.55;
          const radiusHandleY = centerY + directionY * radiusPx * 0.55;
          const closeX = hingeX + outwardX * 24 + directionX * 18;
          const closeY = hingeY + outwardY * 24 + directionY * 18;
          return (
            <g key={item.id} className="pointer-events-auto touch-none text-ink drop-shadow-sm">
              <line x1={hingeX} y1={hingeY} x2={needleShoulderX} y2={needleShoulderY} stroke="var(--ink)" strokeWidth={13} strokeLinecap="round" opacity={0.24} pointerEvents="none" />
              <line x1={hingeX} y1={hingeY} x2={needleShoulderX} y2={needleShoulderY} stroke="color-mix(in srgb, var(--paper) 64%, var(--crater))" strokeWidth={9} strokeLinecap="round" pointerEvents="none" />
              <line x1={hingeX} y1={hingeY} x2={tipX} y2={tipY} stroke="var(--ink)" strokeWidth={14} strokeLinecap="round" opacity={0.22} pointerEvents="none" />
              <line x1={hingeX} y1={hingeY} x2={tipX} y2={tipY} stroke="color-mix(in srgb, var(--paper) 58%, var(--crater))" strokeWidth={10} strokeLinecap="round" pointerEvents="none" />
              <line x1={pencilTopX} y1={pencilTopY} x2={tipX} y2={tipY} stroke="var(--rose)" strokeWidth={9} strokeLinecap="round" pointerEvents="none" />
              <line x1={pencilTopX} y1={pencilTopY} x2={tipX} y2={tipY} stroke="color-mix(in srgb, var(--moon) 58%, transparent)" strokeWidth={4} strokeLinecap="round" pointerEvents="none" />
              <line x1={needleBraceX} y1={needleBraceY} x2={pencilBraceX} y2={pencilBraceY} stroke="var(--ink)" strokeWidth={5} strokeLinecap="round" opacity={0.62} pointerEvents="none" />
              <circle cx={braceMidX} cy={braceMidY} r={6} fill="var(--paper)" stroke="var(--crater)" strokeWidth={2} pointerEvents="none" />
              <circle cx={braceMidX} cy={braceMidY} r={2} fill="var(--crater)" pointerEvents="none" />
              <path
                d={`M ${needleShoulderX + needleSideX * 4} ${needleShoulderY + needleSideY * 4} L ${centerX} ${centerY} L ${needleShoulderX - needleSideX * 4} ${needleShoulderY - needleSideY * 4} Z`}
                fill="var(--ink)"
                pointerEvents="none"
              />
              <g transform={`translate(${hingeX} ${hingeY}) rotate(${angle})`} pointerEvents="none">
                <rect x={-5} y={-25} width={10} height={17} rx={4} fill="color-mix(in srgb, var(--paper) 55%, var(--crater))" stroke="var(--crater)" />
              </g>
              <circle cx={hingeX} cy={hingeY} r={16} fill="var(--crater)" opacity={0.28} pointerEvents="none" />
              <circle cx={hingeX} cy={hingeY} r={12} fill="color-mix(in srgb, var(--moon) 68%, var(--paper))" stroke="var(--crater)" strokeWidth={2} pointerEvents="none" />
              <circle cx={hingeX} cy={hingeY} r={4} fill="var(--paper)" stroke="var(--ink)" pointerEvents="none" />
              <line x1={hingeX - directionX * 3} y1={hingeY - directionY * 3} x2={hingeX + directionX * 3} y2={hingeY + directionY * 3} stroke="var(--ink)" strokeWidth={1.5} pointerEvents="none" />
              <line x1={centerX} y1={centerY} x2={tipX} y2={tipY} stroke="var(--crater)" strokeWidth={1} strokeDasharray="4 4" opacity={0.4} pointerEvents="none" />
              <g className="cursor-move" onPointerDown={(event) => beginAdjust(event, item, "move")}>
                <line x1={hingeX} y1={hingeY} x2={centerX} y2={centerY} stroke="transparent" strokeWidth={28} strokeLinecap="round" />
                <circle cx={moveBadgeX} cy={moveBadgeY} r={9} fill="var(--paper)" stroke="var(--line)" strokeWidth={1.5} />
                <Move x={moveBadgeX - 5} y={moveBadgeY - 5} width={10} height={10} pointerEvents="none" />
              </g>
              <g className="cursor-crosshair" onPointerDown={(event) => beginCompassArc(event, item)}>
                <line x1={pencilHitStartX} y1={pencilHitStartY} x2={tipX} y2={tipY} stroke="transparent" strokeWidth={28} strokeLinecap="round" />
                <circle cx={tipX} cy={tipY} r={24} fill="transparent" />
                <circle cx={tipX} cy={tipY} r={13} fill="color-mix(in srgb, var(--paper) 82%, transparent)" stroke="var(--rose)" strokeWidth={2} strokeDasharray="3 2" />
                <Pencil x={tipX - 7} y={tipY - 7} width={14} height={14} color="var(--rose)" pointerEvents="none" />
              </g>
              <g className="cursor-ew-resize" onPointerDown={(event) => beginAdjust(event, item, "radius")}>
                <circle cx={radiusHandleX} cy={radiusHandleY} r={17} fill="transparent" />
                <circle cx={radiusHandleX} cy={radiusHandleY} r={8} fill="var(--paper)" stroke="var(--crater)" strokeWidth={2} />
                <circle cx={radiusHandleX} cy={radiusHandleY} r={2} fill="var(--crater)" pointerEvents="none" />
              </g>
              <g transform={`translate(${closeX} ${closeY})`} className="cursor-pointer" onPointerDown={(event) => { event.stopPropagation(); store.getState().removeInstrument(item.id); }}><circle r={9} fill="var(--paper)" stroke="var(--line)" /><X x={-6} y={-6} width={12} height={12} /></g>
              <title>{t("compassHint")}</title>
            </g>
          );
        }
        const protractorRadius = instrumentWidth / 2;
        const protractorHeight = protractorRadius;
        const baselineY = protractorHeight / 2;
        const innerRadius = protractorRadius * 0.66;
        return (
          <g key={item.id} className="pointer-events-auto text-ink drop-shadow-sm" transform={`translate(${item.x * width} ${item.y * height}) rotate(${item.rotation})`}>
            <path
              d={`M ${-protractorRadius} ${baselineY} A ${protractorRadius} ${protractorRadius} 0 0 1 ${protractorRadius} ${baselineY} L ${-protractorRadius} ${baselineY} Z`}
              fill="color-mix(in srgb, var(--moon) 34%, transparent)"
              stroke="var(--crater)"
              strokeWidth={1.5}
              className="cursor-move"
              onPointerDown={(event) => beginAdjust(event, item, "move")}
            />
            <path
              d={`M ${-innerRadius} ${baselineY} A ${innerRadius} ${innerRadius} 0 0 1 ${innerRadius} ${baselineY} L ${-innerRadius} ${baselineY} Z`}
              fill="color-mix(in srgb, var(--paper) 48%, transparent)"
              stroke="color-mix(in srgb, var(--crater) 65%, transparent)"
              strokeWidth={1}
              pointerEvents="none"
            />
            <ProtractorTicks width={instrumentWidth} height={protractorHeight} />
            <line x1={-protractorRadius} x2={protractorRadius} y1={baselineY} y2={baselineY} stroke="var(--crater)" strokeWidth={1.5} pointerEvents="none" />
            {Array.from({ length: 21 }, (_, index) => {
              const x = -protractorRadius + index * instrumentWidth / 20;
              const tick = index % 5 === 0 ? protractorHeight * 0.1 : protractorHeight * 0.055;
              return <line key={index} x1={x} x2={x} y1={baselineY} y2={baselineY - tick} stroke="var(--crater)" strokeWidth={index % 5 === 0 ? 1 : 0.65} opacity={0.62} pointerEvents="none" />;
            })}
            <line x1={-instrumentWidth * 0.08} x2={instrumentWidth * 0.08} y1={baselineY} y2={baselineY} stroke="var(--ink)" strokeWidth={1} pointerEvents="none" />
            <line x1={0} x2={0} y1={baselineY - protractorHeight * 0.12} y2={baselineY + protractorHeight * 0.03} stroke="var(--ink)" strokeWidth={1} pointerEvents="none" />
            <circle cx={0} cy={baselineY} r={12} fill="color-mix(in srgb, var(--paper) 70%, transparent)" stroke="var(--crater)" strokeDasharray="3 2" className="cursor-move" onPointerDown={(event) => beginAdjust(event, item, "move")} />
            <g transform={`translate(${22} ${baselineY + 15})`} className="cursor-crosshair" onPointerDown={(event) => beginProtractorRay(event, item)}>
              <circle r={9} fill="var(--paper)" stroke="var(--rose)" strokeWidth={1.5} />
              <Pencil x={-5} y={-5} width={10} height={10} color="var(--rose)" pointerEvents="none" />
            </g>
            <g transform={`translate(0 ${-protractorHeight / 2 - 18})`} className="cursor-grab" onPointerDown={(event) => beginAnchoredRotate(event, item, [0, baselineY])}>
              <circle r={9} fill="var(--paper)" stroke="var(--crater)" strokeWidth={1.5} />
              <RotateCw x={-5} y={-5} width={10} height={10} pointerEvents="none" />
            </g>
            <g transform={`translate(${protractorRadius + 18} ${baselineY})`} className="cursor-pointer" onPointerDown={() => store.getState().removeInstrument(item.id)}><circle r={9} fill="var(--paper)" stroke="var(--line)" /><X x={-6} y={-6} width={12} height={12} /></g>
            <title>{t("protractorHint")}</title>
          </g>
        );
      })}
    </svg>
  );
}
