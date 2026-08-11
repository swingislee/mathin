"use client";

import { cn } from "@/lib/utils";
import type { OrthographicView } from "../domain";
import type { VoxelRenderModel } from "./voxel-render-model";

export interface VoxelRendererMessages {
  readonly webglUnavailable: string;
  readonly contextLost: string;
  readonly unrevealedCount: string;
  readonly formatProjection: (view: OrthographicView) => string;
  readonly formatLayerCount: (label: string, count: number | null, visible: boolean) => string;
  readonly formatTotalCount: (count: number) => string;
  readonly formatHiddenByLayerCount: (count: number) => string;
  readonly formatProjectedCell: (u: number, v: number, stackSize: number | null) => string;
}

export interface VoxelFallbackProps {
  readonly model: VoxelRenderModel;
  readonly messages: VoxelRendererMessages;
  readonly statusMessage?: string;
  readonly className?: string;
}

const CELL_SIZE = 40;
const PADDING = 18;

export function VoxelFallback({ model, messages, statusMessage, className }: VoxelFallbackProps) {
  const bounds = model.projection.bounds;
  const width = bounds ? (bounds.maxU - bounds.minU + 1) * CELL_SIZE : CELL_SIZE;
  const height = bounds ? (bounds.maxV - bounds.minV + 1) * CELL_SIZE : CELL_SIZE;
  const viewBox = `${-PADDING} ${-PADDING} ${width + PADDING * 2} ${height + PADDING * 2}`;

  return (
    <figure
      className={cn("grid h-full w-full grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-paper text-ink", className)}
      data-layout-profile={model.profile}
      data-spatial-fallback="voxel-projection-2d-v1"
    >
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(10rem,32%)] gap-3 p-4 pt-16">
        <svg
          className="min-h-0 w-full self-stretch"
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${messages.formatProjection(model.projectionView)} · ${model.summary}`}
        >
          <title>{messages.formatProjection(model.projectionView)}</title>
          <desc>{model.summary}</desc>
          {model.projection.cells.map((cell) => {
            const x = bounds ? (cell.u - bounds.minU) * CELL_SIZE : 0;
            const y = bounds ? (bounds.maxV - cell.v) * CELL_SIZE : 0;
            return (
              <g key={`${cell.u}:${cell.v}`}>
                <rect
                  x={x + 1}
                  y={y + 1}
                  width={CELL_SIZE - 2}
                  height={CELL_SIZE - 2}
                  rx={4}
                  fill="var(--leaf)"
                  fillOpacity={0.8}
                  stroke="var(--crater)"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
                {model.projectionDepthRevealed && cell.stackSize > 1 ? (
                  <text x={x + CELL_SIZE / 2} y={y + CELL_SIZE / 2} dy="0.35em" textAnchor="middle" fontSize={14} fill="var(--ink)">
                    {cell.stackSize}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        <div className="min-h-0 overflow-auto rounded-2xl border border-line bg-card/90 p-3">
          <p className="text-xs font-medium text-muted">{messages.formatProjection(model.projectionView)}</p>
          <ul className="mt-2 space-y-1 text-xs leading-5">
            {model.layers.map((layer) => (
              <li key={layer.id} className={cn("rounded-lg px-2 py-1", layer.visible ? "bg-leaf/20" : "text-muted line-through")}>
                {messages.formatLayerCount(layer.label, layer.countRevealed ? layer.count : null, layer.visible)}
              </li>
            ))}
          </ul>
          {model.totalCountRevealed ? (
            <p className="mt-3 border-t border-line pt-2 text-sm font-medium text-ink">
              {messages.formatTotalCount(model.totalCellCount)}
            </p>
          ) : null}
          {model.hiddenByLayerCount > 0 ? (
            <p className="mt-1 text-xs text-muted">{messages.formatHiddenByLayerCount(model.hiddenByLayerCount)}</p>
          ) : null}
        </div>
      </div>
      <figcaption className="border-t border-line bg-card/90 px-4 py-2 text-xs leading-5 text-muted">
        {statusMessage ? <span className="font-medium text-rose-deep">{statusMessage} </span> : null}
        {model.summary}
      </figcaption>
      <div className="sr-only">
        <ul>
          {model.projection.cells.map((cell) => (
            <li key={`${cell.u}:${cell.v}`}>
              {messages.formatProjectedCell(cell.u, cell.v, model.projectionDepthRevealed ? cell.stackSize : null)}
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
