"use client";

import { Button } from "@/components/ui/button";
import type { Axis } from "@/features/spatial-math/domain";
import { SpatialAxisIcon, SpatialIconButton } from "./SpatialWorkbenchControls";

/** 准确移动／旋转共用 XYZ 行；领域决定步长与合法终点，不在面板里另算几何。 */
export function SpatialAxisSteps({ label, unit = "", step, disabled, axis, onAxisChange, onStep, formatLabel }: {
  label: string; unit?: string; step: number; disabled?: boolean; axis?: Axis;
  onAxisChange?: (axis: Axis) => void; onStep: (axis: Axis, sign: -1 | 1) => void;
  formatLabel?: (axis: Axis, sign: -1 | 1) => string;
}) {
  return <div className="space-y-1" role="group" aria-label={label} data-spatial-axis-steps>
    {(["x", "y", "z"] as const).map((value) => <div key={value} className="flex items-center gap-2">
      {onAxisChange ? <SpatialIconButton label={`${value.toUpperCase()} ${label}`} active={axis === value} disabled={disabled} onClick={() => onAxisChange(value)}><SpatialAxisIcon axis={value} /></SpatialIconButton>
        : <span className="size-7 shrink-0" aria-label={value.toUpperCase()}><SpatialAxisIcon axis={value} /></span>}
      {([-1, 1] as const).map((sign) => <Button key={sign} type="button" size="sm" variant="secondary" disabled={disabled}
        aria-label={formatLabel?.(value, sign) ?? `${label} ${value.toUpperCase()} ${sign > 0 ? "+" : "−"}${step}${unit}`}
        onClick={() => onStep(value, sign)}>{sign > 0 ? "+" : "−"}{step}{unit}</Button>)}
    </div>)}
  </div>;
}
