"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { SpatialScene } from "../domain";
import {
  buildPolyhedronNetFallbackModel,
  type SpatialRendererLocale,
} from "./polyhedron-fold-render-model";

export interface PolyhedronNetFallbackProps {
  readonly scene: SpatialScene;
  readonly entityId: string;
  readonly locale: SpatialRendererLocale;
  readonly selectedFaceIds?: readonly string[];
  readonly readOnly?: boolean;
  readonly onFaceSelect?: (faceId: string) => void;
  readonly statusMessage?: string;
  readonly className?: string;
}

export function PolyhedronNetFallback({
  scene,
  entityId,
  locale,
  selectedFaceIds = [],
  readOnly = false,
  onFaceSelect,
  statusMessage,
  className,
}: PolyhedronNetFallbackProps) {
  const model = useMemo(
    () => buildPolyhedronNetFallbackModel(scene, entityId, locale, selectedFaceIds),
    [entityId, locale, scene, selectedFaceIds],
  );
  const interactive = !readOnly && Boolean(onFaceSelect);
  const viewBox = `${model.viewBox.x} ${model.viewBox.y} ${model.viewBox.width} ${model.viewBox.height}`;

  return (
    <figure
      className={cn(
        "grid h-full w-full grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-paper text-ink",
        className,
      )}
      data-layout-profile={model.profile}
      data-spatial-fallback="polyhedron-net-2d-v1"
    >
      <svg
        className="min-h-0 w-full self-stretch p-4"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={model.summary}
      >
        <title>{model.label}</title>
        <desc>{model.summary}</desc>
        {model.faces.map((face) => (
          <g key={face.faceId} data-face-id={face.faceId}>
            <polygon
              points={face.points.map((point) => `${point.x},${point.y}`).join(" ")}
              fill={face.selected ? "var(--moon)" : "var(--leaf)"}
              fillOpacity={face.selected ? 0.98 : 0.72}
              stroke={face.selected ? "var(--rose-deep)" : "var(--crater)"}
              strokeWidth={face.selected ? 2.25 : 1.5}
              vectorEffect="non-scaling-stroke"
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={face.label}
              aria-pressed={interactive ? face.selected : undefined}
              className={interactive ? "cursor-pointer outline-none focus-visible:stroke-rose" : undefined}
              onClick={interactive ? () => onFaceSelect?.(face.faceId) : undefined}
              onKeyDown={
                interactive
                  ? (event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onFaceSelect?.(face.faceId);
                    }
                  : undefined
              }
            />
            <text
              x={face.centroid.x}
              y={face.centroid.y}
              dy="0.35em"
              textAnchor="middle"
              fontSize={model.labelFontSize}
              fill="var(--ink)"
              pointerEvents="none"
            >
              {face.label}
            </text>
          </g>
        ))}
        {model.hinges.map((hinge) => {
          const centerX = (hinge.from.x + hinge.to.x) / 2;
          const centerY = (hinge.from.y + hinge.to.y) / 2;
          return (
            <g key={hinge.edgeId} pointerEvents="none" data-hinge-edge-id={hinge.edgeId}>
              <line
                x1={hinge.from.x}
                y1={hinge.from.y}
                x2={hinge.to.x}
                y2={hinge.to.y}
                stroke="var(--rose-deep)"
                strokeWidth={2}
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={centerX} cy={centerY} r={model.labelFontSize * 0.48} fill="var(--paper)" stroke="var(--rose-deep)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text
                x={centerX}
                y={centerY}
                dy="0.34em"
                textAnchor="middle"
                fontSize={model.labelFontSize * 0.64}
                fill="var(--rose-deep)"
              >
                {hinge.order}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="border-t border-line bg-card/90 px-4 py-2 text-xs leading-5 text-muted">
        {statusMessage ? <span className="font-medium text-rose-deep">{statusMessage} </span> : null}
        {model.summary}
      </figcaption>
      <div className="sr-only">
        <ul>
          {model.faces.map((face) => (
            <li key={face.faceId}>{face.label}</li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
