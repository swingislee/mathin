"use client";

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { CubeIconButton } from "../spatial-lab/CubeWorkbenchControls";
import { CUBE_AXIS_COLORS } from "../spatial-lab/cube-structures-contract";
import { SPATIAL_ROLL_DIRECTIONS, type SpatialRollDirection, type SpatialRollPlan } from "./rolling";

export interface SpatialRollAction {
  label: string; disabled?: boolean;
  onRoll: (direction: SpatialRollDirection) => void;
  plans: Partial<Record<SpatialRollDirection, SpatialRollPlan>>;
}
const icons = { "x+": ArrowRight, "x-": ArrowLeft, "z+": ArrowDown, "z-": ArrowUp };
export function SpatialRollButtons({ action, onHint }: { action: SpatialRollAction; onHint?: (direction: SpatialRollDirection | null) => void }) {
  return <div className="flex gap-0.5" role="group" aria-label={action.label}>
    {SPATIAL_ROLL_DIRECTIONS.map((direction) => {
      const Icon = icons[direction], color = CUBE_AXIS_COLORS[direction[0] as "x" | "z"];
      return <CubeIconButton key={direction} label={`${action.label} ${direction.toUpperCase()}`} className="relative" disabled={action.disabled || !action.plans[direction]}
        onPointerEnter={() => onHint?.(direction)} onPointerLeave={() => onHint?.(null)} onFocus={() => onHint?.(direction)} onBlur={() => onHint?.(null)} onClick={() => action.onRoll(direction)}>
        <Icon aria-hidden style={{ color }} /><span aria-hidden className="absolute bottom-0 right-0.5 text-[9px] font-semibold leading-none" style={{ color }}>{direction.toUpperCase()}</span>
      </CubeIconButton>;
    })}
  </div>;
}
