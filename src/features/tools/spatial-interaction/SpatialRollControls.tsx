"use client";

import { useState } from "react";
import { Line } from "@react-three/drei";
import { CUBE_AXIS_COLORS } from "../spatial-lab/cube-structures-contract";
import { spatialRollPoint, type SpatialRollDirection } from "./rolling";
import { SpatialObjectToolbar, type SpatialObjectToolbarTarget } from "./SpatialObjectToolbar";
import { SpatialRollButtons, type SpatialRollAction } from "./SpatialRollButtons";
/** 方向沿世界 X/Z；悬停时直接在对象上画出接触棱与中心路径。 */
export function SpatialRollControls({ center, vertices, moveHandles, radius = 1, action }: SpatialObjectToolbarTarget & { radius?: number; action: SpatialRollAction }) {
  const [direction, setDirection] = useState<SpatialRollDirection | null>(null);
  const plan = direction && action.plans[direction], color = CUBE_AXIS_COLORS[direction?.[0] === "z" ? "z" : "x"];
  const r = Math.max(0.85, radius);
  return <group name="spatial-object-roll">
    {plan && <>
      <Line points={Array.from({ length: 33 }, (_, i) => { const p = spatialRollPoint(center, plan, i / 32); return [p.x, p.y, p.z] as [number, number, number]; })} color={color} lineWidth={2} depthTest={false} raycast={() => null} />
      <Line points={[-1, 1].map((sign) => [plan.pivot.x + (plan.axis === "x" ? center.x + sign * r : 0), plan.pivot.y, plan.pivot.z + (plan.axis === "z" ? center.z + sign * r : 0)] as [number, number, number])} color={color} lineWidth={3} depthTest={false} raycast={() => null} />
    </>}
    <SpatialObjectToolbar center={center} vertices={vertices} moveHandles={moveHandles}>
      <div className="rounded-xl border border-line bg-paper/95 p-1 shadow-sm" role="toolbar" aria-label={action.label} data-spatial-object-actions onPointerDown={(event) => event.stopPropagation()}>
        <SpatialRollButtons action={action} onHint={setDirection} />
      </div>
    </SpatialObjectToolbar>
  </group>;
}
