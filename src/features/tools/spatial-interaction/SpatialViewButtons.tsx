"use client";

import { SpatialIconButton, SpatialViewIcon } from "./SpatialWorkbenchControls";
import { SpatialActionButton } from "./SpatialActionButton";
import type { CubeView } from "../spatial-lab/cube-structures-contract";

export const SPATIAL_STANDARD_VIEWS = ["angle", "front", "left", "right", "top"] as const;
export const SPATIAL_ALL_VIEWS = [...SPATIAL_STANDARD_VIEWS, "bottom"] as const;
export type SpatialView = CubeView | "bottom";

/** 只统一视角入口，视图保存和相机重取景仍由原工作台回调完成。 */
export function SpatialViewButtons<V extends SpatialView>({ views, value, labels, disabled, onChange, fit }: {
  views: readonly V[]; value: V; labels: Record<V, string>; disabled?: boolean; onChange: (view: V) => void;
  fit?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return <>{views.map((view) => <SpatialIconButton key={view} label={labels[view]} active={value === view} disabled={disabled}
    onClick={() => onChange(view)} data-spatial-view={view}><SpatialViewIcon view={view} /></SpatialIconButton>)}
    {fit && <SpatialActionButton action="fit" label={fit.label} disabled={fit.disabled ?? disabled} onClick={fit.onClick} />}</>;
}
