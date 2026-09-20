"use client";

import { useState } from "react";
import { Html, Line } from "@react-three/drei";
import { Rotate3D, RotateCcw, RotateCw } from "lucide-react";
import { useThree } from "@react-three/fiber";
import { Quaternion, Vector3, type Camera, type Object3D } from "three";
import type { Axis, VoxelCoordinate } from "@/features/spatial-math/domain";
import { CUBE_AXIS_COLORS } from "../spatial-lab/cube-structures-contract";
import { CubeIconButton } from "../spatial-lab/CubeWorkbenchControls";
import { startSpatialRotationGrip } from "./object-gesture-controller";

export interface SpatialRotationAction {
  axis: Axis; onAxisChange: (axis: Axis) => void;
  onRotate: (axis: Axis, turn: -1 | 1) => void;
  label: string; disabled?: boolean;
  gestureLabel?: string; precise?: boolean;
  gestureMode?: { active: boolean; onToggle: () => void };
}
export function spatialToolbarPosition(object: Object3D, camera: Camera, size: { width: number; height: number }): [number, number] {
  const p = new Vector3().setFromMatrixPosition(object.matrixWorld).project(camera);
  const margin = Math.min(88, size.width / 2);
  return [Math.max(margin, Math.min(size.width - margin, (p.x + 1) * size.width / 2)), Math.max(76, Math.min(size.height - 32, (1 - p.y) * size.height / 2))];
}
export function SpatialRotationAnchor({ center }: { center: VoxelCoordinate }) {
  return <group name="spatial-rotation-anchor">
    {(["x", "y", "z"] as const).map((axis) => <Line key={axis} points={[-1, 1].map((sign) => [center.x + (axis === "x" ? sign * 0.13 : 0), center.y + (axis === "y" ? sign * 0.13 : 0), center.z + (axis === "z" ? sign * 0.13 : 0)] as [number, number, number])}
      color={CUBE_AXIS_COLORS[axis]} lineWidth={3} depthTest={false} depthWrite={false} raycast={() => null} />)}
  </group>;
}
/** 同一组世界轴、方向预告和 90° 入口用于结构、Soma、实体和骰子。 */
export function SpatialRotationControls({ center, radius = 1, action }: {
  center: VoxelCoordinate; radius?: number; action: SpatialRotationAction;
}) {
  const canvas = useThree((state) => state.gl.domElement);
  const [hint, setHint] = useState(false);
  const [direction, setDirection] = useState<-1 | 1 | null>(null);
  const r = Math.max(0.85, radius), axis = action.axis, color = CUBE_AXIS_COLORS[axis];
  const point = (angle: number): [number, number, number] => {
    const a = Math.cos(angle) * r, b = Math.sin(angle) * r;
    return axis === "x" ? [center.x, center.y + a, center.z + b]
      : axis === "y" ? [center.x + b, center.y, center.z + a] : [center.x + a, center.y + b, center.z];
  };
  const tip = point((direction ?? 1) * Math.PI / 2);
  const tangent = new Vector3(...tip).sub(new Vector3(...point((direction ?? 1) * Math.PI / 2 - (direction ?? 1) * 0.01))).normalize();
  return <group name="spatial-object-rotation">
    {action.gestureLabel && <SpatialRotationAnchor center={center} />}
    {hint && action.precise !== false && <><Line points={Array.from({ length: 65 }, (_, i) => point(direction ? direction * i * Math.PI / 128 : i * Math.PI / 32))} color={color} lineWidth={2} depthWrite={false} depthTest={false} raycast={() => null} />
      {direction && <mesh position={tip} quaternion={new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), tangent)} raycast={() => null}>
        <coneGeometry args={[r * 0.07, r * 0.22, 12]} /><meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </mesh>}
      <Line points={[[center.x, center.y, center.z], [center.x + (axis === "x" ? r : 0), center.y + (axis === "y" ? r : 0), center.z + (axis === "z" ? r : 0)]]} color={color} lineWidth={2} depthTest={false} raycast={() => null} />
    </>}
    <Html position={[center.x, center.y + r + 0.35, center.z]} center calculatePosition={spatialToolbarPosition} zIndexRange={[7, 0]}>
      <div className="flex gap-0.5 rounded-xl border border-line bg-paper/95 p-1 shadow-sm" role="toolbar" aria-label={action.label}
        data-spatial-object-actions onPointerDown={(event) => event.stopPropagation()} onPointerEnter={() => setHint(true)} onPointerLeave={() => { setHint(false); setDirection(null); }}
        onFocus={() => setHint(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHint(false); }}>
        {action.gestureLabel && <CubeIconButton label={action.gestureLabel} active={action.gestureMode?.active} disabled={action.disabled} data-spatial-rotation-grip style={{ width: 44, height: 44, minWidth: 44, touchAction: "none" }}
          onPointerDown={(event) => { if (!action.gestureMode) { event.preventDefault(); event.stopPropagation(); startSpatialRotationGrip(canvas, event.nativeEvent); } }}
          onClick={(event) => { if (action.gestureMode) action.gestureMode.onToggle(); else if (event.detail === 0) action.onRotate(axis, 1); }}><Rotate3D aria-hidden /></CubeIconButton>}
        {action.precise !== false && (["x", "y", "z"] as const).map((value) => <CubeIconButton key={value} label={`${action.label} ${value.toUpperCase()}`} active={axis === value} disabled={action.disabled} onClick={() => action.onAxisChange(value)}>
          <span className="text-xs font-bold" style={{ color: CUBE_AXIS_COLORS[value] }}>{value.toUpperCase()}</span>
        </CubeIconButton>)}
        {action.precise !== false && ([-1, 1] as const).map((turn) => <CubeIconButton key={turn} label={`${action.label} ${axis.toUpperCase()} ${turn > 0 ? "+" : "−"}90°`} disabled={action.disabled} onPointerEnter={() => setDirection(turn)} onFocus={() => setDirection(turn)} onClick={() => action.onRotate(axis, turn)}>
          {turn > 0 ? <RotateCcw aria-hidden style={{ color }} /> : <RotateCw aria-hidden style={{ color }} />}
        </CubeIconButton>)}
      </div>
    </Html>
  </group>;
}
